// Phase 7 — Live slot subscription over the Yellowstone gRPC stream.
//
// Emits typed SlotUpdate events to the rest of the system. Shared domain types
// come from src/types/index.ts (the single source of truth).
import { EventEmitter } from "eventemitter3";
import type { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { GeyserClient, GeyserError, type GeyserStreamLike } from "./geyser";
import type { SlotUpdate } from "../../types";

/**
 * Maps Yellowstone slot-status / commitment levels (numeric) to our commitment
 * strings. The numeric values are shared by both SlotStatus and CommitmentLevel
 * (PROCESSED=0, CONFIRMED=1, FINALIZED=2). Any other value (first-shred,
 * completed, dead, unrecognized, ...) is intentionally absent and skipped.
 */
const STATUS_TO_COMMITMENT: Record<number, SlotUpdate["commitment"]> = {
  0: "processed",
  1: "confirmed",
  2: "finalized"
};

/** Typed event map so emit()/on() are checked by the compiler. */
export interface SlotSubscriberEvents {
  slot: (update: SlotUpdate) => void;
  error: (error: GeyserError) => void;
}

/**
 * Subscribes to live slot updates from a Yellowstone stream and re-emits them
 * as typed "slot" events, keeping a small ring buffer of the most recent ones.
 */
export class SlotSubscriber extends EventEmitter<SlotSubscriberEvents> {
  private readonly geyserClient: GeyserClient;
  private recentSlots: SlotUpdate[] = [];
  private running = false;
  private stream: GeyserStreamLike | null = null;

  constructor(geyserClient: GeyserClient) {
    super();
    this.geyserClient = geyserClient;
    console.log("[slot] 🎰 SlotSubscriber initialized");
  }

  /**
   * Open the slot subscription and begin emitting "slot" events. Stream and
   * handler errors are surfaced via the "error" event, never thrown.
   */
  async subscribe(): Promise<void> {
    const client = this.geyserClient.getClient();
    const stream = await client.subscribe();
    this.stream = stream;

    // All top-level Yellowstone request fields must be present (even if empty)
    // or the server silently ignores the subscription.
    const request = {
      slots: { client: {} },
      accounts: {},
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: []
    };
    stream.write(request);

    this.running = true;

    stream.on("data", (update: SubscribeUpdate) => {
      // Never throw inside the message handler — emit "error" instead so a
      // single bad message can never crash the process.
      try {
        if (!this.running) {
          return;
        }
        if (!update.slot) {
          return; // ping/pong/account/etc. — not a slot update
        }

        const commitment = STATUS_TO_COMMITMENT[update.slot.status];
        if (!commitment) {
          return; // unknown commitment/status — skip silently
        }

        const slot = Number(update.slot.slot);
        if (!Number.isFinite(slot)) {
          return;
        }

        const slotUpdate: SlotUpdate = {
          slot,
          commitment,
          timestamp: Date.now()
        };

        this.pushRecent(slotUpdate);
        this.emit("slot", slotUpdate);

        // Only log confirmed slots to avoid flooding the terminal.
        if (commitment === "confirmed") {
          console.log(`[slot] 🎰 Slot ${slot} confirmed`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit(
          "error",
          new GeyserError(
            `Error handling slot update: ${message}`,
            "SLOT_HANDLER_ERROR",
            error
          )
        );
      }
    });

    stream.on("error", (error: Error) => {
      this.emit(
        "error",
        new GeyserError(
          `Slot stream error: ${error.message}`,
          "STREAM_ERROR",
          error
        )
      );
    });
  }

  /** Stop the subscription and tear down the stream. */
  async unsubscribe(): Promise<void> {
    this.running = false;
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
    console.log("[slot] 🛑 Slot subscription stopped");
  }

  /** Most recent slots, newest first (a copy — safe to mutate). */
  getRecentSlots(): SlotUpdate[] {
    return [...this.recentSlots].reverse();
  }

  /** The single most recent slot update, or null if none seen yet. */
  getLatestSlot(): SlotUpdate | null {
    if (this.recentSlots.length === 0) {
      return null;
    }
    return this.recentSlots[this.recentSlots.length - 1];
  }

  /** The most recent "confirmed" slot update, or null if none seen yet. */
  getLatestConfirmedSlot(): SlotUpdate | null {
    for (let i = this.recentSlots.length - 1; i >= 0; i--) {
      if (this.recentSlots[i].commitment === "confirmed") {
        return this.recentSlots[i];
      }
    }
    return null;
  }

  /** Append to the ring buffer, evicting the oldest beyond a max of 10. */
  private pushRecent(update: SlotUpdate): void {
    this.recentSlots.push(update);
    if (this.recentSlots.length > 10) {
      this.recentSlots.shift();
    }
  }
}
