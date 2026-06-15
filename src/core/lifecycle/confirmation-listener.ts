// Phase 18 — Stream-based confirmation listener.
// CRITICAL: Uses Geyser stream for confirmation — NOT RPC polling alone.
import { PaymentStatus } from "../../types";
import type { BundleSubmission } from "../../types";
import type { LifecycleTracker } from "./tracker";
import type { GeyserClient, GeyserStreamLike } from "../stream/geyser";
import type { SubscribeUpdate } from "@triton-one/yellowstone-grpc";

interface WatchEntry {
  paymentId: string;
  bundleId: string;
  addedAt: number;
}

export class ConfirmationListener {
  private readonly geyserClient: GeyserClient;
  private readonly tracker: LifecycleTracker;
  private watchedSignatures = new Map<string, WatchEntry>();
  private stream: GeyserStreamLike | null = null;

  constructor(geyserClient: GeyserClient, tracker: LifecycleTracker) {
    this.geyserClient = geyserClient;
    this.tracker = tracker;
    console.log("[confirm] 👂 ConfirmationListener initialized");
  }

  async start(): Promise<void> {
    await this.openStream();
    console.log("[confirm] ▶️ Confirmation stream started");
  }

  private async openStream(): Promise<void> {
    try {
      const client = this.geyserClient.getClient();
      const stream = await client.subscribe();
      this.stream = stream;

      // Subscribe to transaction updates — we update the filter as signatures arrive
      stream.write({
        slots: {},
        accounts: {},
        transactions: {},
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
      });

      stream.on("data", (update: SubscribeUpdate) => {
        try {
          this.handleUpdate(update);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[confirm] ❌ Error handling confirmation update: ${msg}`);
        }
      });

      stream.on("error", (error: Error) => {
        console.warn(
          `[confirm] ⚠️ Confirmation stream error: ${error.message} — attempting resubscription`
        );
        setTimeout(() => {
          this.openStream().catch((e: Error) => {
            console.error(`[confirm] ❌ Resubscription failed: ${e.message}`);
          });
        }, 2000);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[confirm] ⚠️ Could not open confirmation stream: ${msg}`
      );
    }
  }

  private handleUpdate(update: SubscribeUpdate): void {
    if (!update.transaction) return;

    const txUpdate = update.transaction;
    const sig = txUpdate.transaction?.signature;
    if (!sig) return;

    // Geyser sends signatures as Uint8Array; encode to base58
    let sigBase58: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bs58mod = require("bs58") as { default?: { encode: (b: Uint8Array) => string }; encode?: (b: Uint8Array) => string };
      const encode = (bs58mod.default?.encode ?? bs58mod.encode)!;
      sigBase58 =
        typeof sig === "string"
          ? sig
          : encode(sig as Uint8Array);
    } catch {
      return;
    }

    const entry = this.watchedSignatures.get(sigBase58);
    if (!entry) return;

    const { paymentId, bundleId } = entry;
    const slot = Number(txUpdate.slot ?? 0);

    // Determine status from transaction error field
    const hasError = txUpdate.transaction?.meta?.err !== null &&
      txUpdate.transaction?.meta?.err !== undefined;

    if (hasError) {
      this.tracker.transition(paymentId, bundleId, PaymentStatus.FAILED, slot, {
        confirmationError: "transaction failed on-chain",
      });
    } else {
      // Yellowstone transaction subscription fires at "confirmed" level
      this.tracker.transition(paymentId, bundleId, PaymentStatus.CONFIRMED, slot);
    }
  }

  private updateStreamFilter(): void {
    if (!this.stream || this.watchedSignatures.size === 0) return;

    const sigMap: Record<string, {
      vote: boolean;
      failed: boolean;
      signature: string;
      accountInclude: string[];
      accountExclude: string[];
      accountRequired: string[];
    }> = {};

    for (const [sig] of this.watchedSignatures) {
      sigMap[`watch_${sig.slice(0, 8)}`] = {
        vote: false,
        failed: false,
        signature: sig,
        accountInclude: [],
        accountExclude: [],
        accountRequired: [],
      };
    }

    try {
      this.stream.write({
        slots: {},
        accounts: {},
        transactions: sigMap,
        blocks: {},
        blocksMeta: {},
        accountsDataSlice: [],
      });
    } catch {
      // Stream may be closed; openStream() will reconnect
    }
  }

  stop(): void {
    if (this.stream) {
      try {
        this.stream.destroy();
      } catch {
        // ignore
      }
      this.stream = null;
    }
    console.log("[confirm] ⏹️ Confirmation stream stopped");
  }

  watchBundle(submission: BundleSubmission): void {
    for (const sig of submission.signatures) {
      this.watchedSignatures.set(sig, {
        paymentId: submission.paymentId,
        bundleId: submission.bundleId,
        addedAt: Date.now(),
      });
    }

    this.updateStreamFilter();

    console.log(
      `[confirm] 👁️ Watching ${submission.signatures.length} signatures for bundle ${submission.bundleId}`
    );
  }

  unwatchPayment(paymentId: string): void {
    let removed = 0;
    for (const [sig, entry] of this.watchedSignatures) {
      if (entry.paymentId === paymentId) {
        this.watchedSignatures.delete(sig);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[confirm] 🚫 Stopped watching payment ${paymentId}`);
      this.updateStreamFilter();
    }
  }

  cleanupStale(maxAgeMs = 120_000): void {
    const now = Date.now();
    let removed = 0;
    for (const [sig, entry] of this.watchedSignatures) {
      if (now - entry.addedAt > maxAgeMs) {
        this.watchedSignatures.delete(sig);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[confirm] 🧹 Cleaned up ${removed} stale signature watchers`);
    }
  }
}
