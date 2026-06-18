// Phase 24 — PayDispatcher orchestrator. Wires all modules together.
import { randomUUID } from "crypto";
import { EventEmitter } from "eventemitter3";
import { PaymentStatus, FaultType } from "./types";
import type {
  PaymentRequest,
  PaymentReceipt,
  BundleSubmission,
  LifecycleEvent,
} from "./types";
import type { Connection, Keypair } from "@solana/web3.js";
import type { LifecycleStore } from "./core/db/store";
import type { SolanaRpcClient } from "./core/rpc/client";
import type { GeyserClient } from "./core/stream/geyser";
import type { SlotSubscriber } from "./core/stream/slot-subscriber";
import type { LeaderDetector } from "./core/stream/leader-detector";
import type { ReconnectionManager } from "./core/stream/reconnect";
import type { NetworkHealthMonitor } from "./core/stream/network-health";
import type { TipFetcher } from "./core/bundle/tip-fetcher";
import type { TipCalculator } from "./core/bundle/tip-calculator";
import type { InstructionBuilder } from "./core/bundle/instruction-builder";
import type { BundleConstructor } from "./core/bundle/bundle-constructor";
import type { BundleSubmitter } from "./core/bundle/submitter";
import type { FailureClassifier } from "./core/bundle/failure-classifier";
import type { LifecycleTracker } from "./core/lifecycle/tracker";
import type { ConfirmationListener } from "./core/lifecycle/confirmation-listener";
import type { ReceiptGenerator } from "./core/lifecycle/receipt-generator";
import type { AgentClient } from "./agent/client";
import type { RetryExecutor } from "./agent/retry-executor";
import type { FaultInjector } from "./agent/fault-injector";
import { validateRecipient } from "./core/bundle/instruction-builder";

export interface DispatcherConfig {
  connection: Connection;
  wallet: Keypair;
  store: LifecycleStore;
  rpcClient: SolanaRpcClient;
  geyserClient: GeyserClient;
  slotSubscriber: SlotSubscriber;
  leaderDetector: LeaderDetector;
  reconnectionManager: ReconnectionManager;
  healthMonitor: NetworkHealthMonitor;
  tipFetcher: TipFetcher;
  tipCalculator: TipCalculator;
  instructionBuilder: InstructionBuilder;
  bundleConstructor: BundleConstructor;
  bundleSubmitter: BundleSubmitter;
  failureClassifier: FailureClassifier;
  tracker: LifecycleTracker;
  confirmationListener: ConfirmationListener;
  receiptGenerator: ReceiptGenerator;
  agentClient: AgentClient;
  retryExecutor: RetryExecutor;
  faultInjector: FaultInjector;
}

interface DispatcherEvents {
  paymentQueued: (payment: PaymentRequest) => void;
  paymentFinalized: (receipt: PaymentReceipt) => void;
  paymentFailed: (paymentId: string, reason: string) => void;
  bundleSubmitted: (submission: BundleSubmission) => void;
  agentDecision: (paymentId: string, decision: unknown) => void;
  retryNotification: (paymentId: string, attempt: number, diagnosis: string, succeeded: boolean) => void;
}

export class PayDispatcher extends EventEmitter<DispatcherEvents> {
  private readonly config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    super();
    this.config = config;
    // Wire agent decision callback so RetryExecutor can broadcast decisions to dashboard
    config.retryExecutor.setDecisionCallback(
      (paymentId, decision, attempt, failureCode) => {
        this.emit("agentDecision", paymentId, { ...decision as object, attempt, failureCode, decidedAt: Date.now() });
      }
    );
    console.log("[dispatcher] 🚀 PayDispatcher initialized");
  }

  async start(): Promise<void> {
    const {
      geyserClient,
      slotSubscriber,
      leaderDetector,
      healthMonitor,
      confirmationListener,
      reconnectionManager,
      bundleSubmitter,
    } = this.config;

    await geyserClient.connect();
    await slotSubscriber.subscribe();
    await leaderDetector.start();
    healthMonitor.start();
    await confirmationListener.start();
    reconnectionManager.watchdog();

    // Auto-watch every bundle submission (including retries) via Geyser
    bundleSubmitter.on("submitted", (sub) => {
      confirmationListener.watchBundle(sub);
    });

    // Wait for first confirmed slot
    await new Promise<void>((resolve) => {
      const check = () => {
        const slot = slotSubscriber.getLatestConfirmedSlot();
        if (slot) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    console.log("[dispatcher] ✅ All systems live. Ready to dispatch.");
  }

  async stop(): Promise<void> {
    const {
      confirmationListener,
      healthMonitor,
      leaderDetector,
      reconnectionManager,
      slotSubscriber,
      geyserClient,
    } = this.config;

    confirmationListener.stop();
    healthMonitor.stop();
    await leaderDetector.stop();
    reconnectionManager.stop();
    await slotSubscriber.unsubscribe();
    await geyserClient.disconnect();

    console.log("[dispatcher] 🛑 PayDispatcher stopped");
  }

  async queuePayment(request: {
    recipient: string;
    amount: number;
    memo?: string;
    tokenMint?: string;
  }): Promise<PaymentRequest> {
    const { tracker, faultInjector } = this.config;

    const faultFromEnv = (process.env.INJECT_FAULT ?? "none") as FaultType;

    const payment: PaymentRequest = {
      id: randomUUID(),
      senderPubkey: this.config.wallet.publicKey.toBase58(),
      recipientPubkey: request.recipient,
      amountLamports: request.amount,
      tokenMint:
        request.tokenMint ??
        (process.env.SOLANA_NETWORK === "mainnet-beta"
          ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  // mainnet USDC
          : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"), // devnet/testnet test USDC
      memo: request.memo,
      createdAt: Date.now(),
      injectFault: faultFromEnv !== FaultType.NONE ? faultFromEnv : undefined,
    };

    // Validate recipient
    const validation = await validateRecipient(
      payment.recipientPubkey,
      process.env.SOLANA_NETWORK ?? "testnet",
      this.config.connection
    );

    if (!validation.isValid) {
      throw new Error(
        validation.warningMessage ?? "Invalid recipient address"
      );
    }

    this.config.tracker.trackNewPayment(payment);
    this.emit("paymentQueued", payment);
    console.log(`[dispatcher] 📥 Payment queued: ${payment.id}`);

    // Fire and forget dispatch
    this.dispatch(payment).catch((err: Error) => {
      console.error(`[dispatcher] ❌ Dispatch error for ${payment.id}: ${err.message}`);
    });

    return payment;
  }

  private async dispatch(payment: PaymentRequest): Promise<void> {
    const {
      tipCalculator,
      faultInjector,
      bundleConstructor,
      bundleSubmitter,
      tracker,
      confirmationListener,
      receiptGenerator,
      retryExecutor,
      rpcClient,
      tipFetcher,
    } = this.config;

    let attempt = 1;
    let tipLamports = tipCalculator.calculateTip(payment.amountLamports, attempt);

    try {
      // Apply fault injection if configured
      let blockhash = await rpcClient.getLatestBlockhash();
      let injectedTip = tipLamports;

      if (faultInjector.shouldInjectForPayment(payment)) {
        const faultType = faultInjector.getFaultType();
        if (faultType === FaultType.BLOCKHASH) {
          blockhash = await faultInjector.injectExpiredBlockhash(rpcClient);
        } else if (faultType === FaultType.LOW_FEE) {
          injectedTip = faultInjector.injectLowFee(tipLamports);
        }
      }

      const { transactions, bundleId } = await bundleConstructor.buildBundleWithBlockhash(
        payment,
        injectedTip,
        blockhash
      );

      const currentSlot = await rpcClient.getSlot().catch(() => 0);
      const tipAccount = tipFetcher.getRandomTipAccount();

      const submission = await bundleSubmitter.submitBundle(
        payment,
        transactions,
        bundleId,
        injectedTip,
        tipAccount,
        blockhash,
        attempt
      );

      this.emit("bundleSubmitted", submission);
      tracker.transition(
        payment.id,
        bundleId,
        PaymentStatus.SUBMITTED,
        currentSlot
      );

      // Listen for status changes on this payment
      await new Promise<void>((resolve) => {
        const onStatus = async (
          paymentId: string,
          status: PaymentStatus,
          event: LifecycleEvent
        ) => {
          if (paymentId !== payment.id) return;

          if (status === PaymentStatus.FINALIZED) {
            tracker.off("statusChange", onStatus);
            confirmationListener.unwatchPayment(payment.id);

            // Use the last submitted bundle's first signature as the final sig
            const allBundles = this.config.store.getBundleSubmissions(payment.id);
            const lastBundle = allBundles[allBundles.length - 1];
            const finalSig = lastBundle?.signatures[0] ?? submission.signatures[0] ?? "unknown";
            const receipt = receiptGenerator.generateReceipt(
              payment,
              finalSig
            );
            if (receipt) {
              receiptGenerator.printReceiptSummary(receipt);
              this.emit("paymentFinalized", receipt);
            }
            resolve();
          } else if (status === PaymentStatus.FAILED) {
            // Use actual error from lifecycle event meta, not a generic message
            const actualError = event.meta?.error
              ? new Error(String(event.meta.error))
              : new Error(`Payment ${payment.id} failed — no error detail`);

            // Try agent-driven retry
            const result = await retryExecutor
              .handleFailure(
                actualError,
                payment,
                event.bundleId,
                injectedTip,
                attempt
              )
              .catch(() => "abandoned" as const);

            if (result === "abandoned") {
              tracker.off("statusChange", onStatus);
              this.emit(
                "paymentFailed",
                payment.id,
                "Max retries exceeded or non-retryable failure"
              );
              resolve();
            } else {
              attempt++;
              injectedTip = tipCalculator.calculateTip(
                payment.amountLamports,
                attempt
              );
              this.emit("retryNotification", payment.id, attempt, "Retrying...", true);
            }
          } else if (status === PaymentStatus.ABANDONED) {
            tracker.off("statusChange", onStatus);
            this.emit("paymentFailed", payment.id, "Payment abandoned");
            resolve();
          }
        };

        tracker.on("statusChange", onStatus);

        // Timeout after 5 minutes
        setTimeout(() => {
          tracker.off("statusChange", onStatus);
          console.warn(
            `[dispatcher] ⚠️ Payment ${payment.id} timed out after 5 minutes`
          );
          this.emit("paymentFailed", payment.id, "Timeout");
          resolve();
        }, 5 * 60 * 1000);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[dispatcher] ❌ Fatal dispatch error: ${msg}`);
      const slot = await rpcClient.getSlot().catch(() => 0);
      tracker.transition(
        payment.id,
        "unknown",
        PaymentStatus.FAILED,
        slot,
        { error: msg }
      );
      this.emit("paymentFailed", payment.id, msg);
    }
  }

  getStatus(paymentId: string): PaymentStatus | null {
    return this.config.tracker.getStatus(paymentId);
  }
}
