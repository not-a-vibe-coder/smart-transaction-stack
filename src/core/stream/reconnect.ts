// Phase 9 — Stream reconnection + backpressure handler.
import { GeyserClient } from "./geyser";
import { SlotSubscriber } from "./slot-subscriber";
import { sleep } from "../rpc/client";

export class ReconnectionManager {
  private readonly geyserClient: GeyserClient;
  private readonly slotSubscriber: SlotSubscriber;
  private readonly maxAttempts: number;
  private attemptCount = 0;
  private backpressureQueue: (() => Promise<void>)[] = [];
  private isReconnecting = false;
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    geyserClient: GeyserClient,
    slotSubscriber: SlotSubscriber,
    maxAttempts = 5
  ) {
    this.geyserClient = geyserClient;
    this.slotSubscriber = slotSubscriber;
    this.maxAttempts = maxAttempts;
    console.log("[reconnect] 🔁 ReconnectionManager initialized");
  }

  watchdog(): void {
    this.watchdogInterval = setInterval(() => {
      const latest = this.slotSubscriber.getLatestSlot();
      const stale = !latest || Date.now() - latest.timestamp > 15_000;

      if (stale && !this.isReconnecting) {
        console.warn("[reconnect] ⚠️ Stream appears stale, triggering reconnect...");
        this.reconnect().catch(() => {
          // reconnect() logs and exits on max attempts; swallow here
        });
      }
    }, 10_000);
  }

  private async reconnect(): Promise<void> {
    if (this.attemptCount >= this.maxAttempts) {
      console.error("[reconnect] ❌ Max reconnect attempts reached. Giving up.");
      process.exit(1);
    }

    this.isReconnecting = true;
    this.attemptCount += 1;
    const delay = Math.min(1000 * Math.pow(2, this.attemptCount), 30_000);

    console.log(
      `[reconnect] 🔁 Reconnecting in ${delay}ms (attempt ${this.attemptCount}/${this.maxAttempts})...`
    );
    await sleep(delay);

    try {
      await this.slotSubscriber.unsubscribe();
      await this.geyserClient.disconnect();
      await this.geyserClient.connect();
      await this.slotSubscriber.subscribe();
      this.attemptCount = 0;
      this.isReconnecting = false;
      console.log("[reconnect] ✅ Reconnected successfully");
      await this.drainQueue();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[reconnect] ⚠️ Reconnect attempt failed: ${msg}`);
      return this.reconnect();
    }
  }

  async drainQueue(): Promise<void> {
    const count = this.backpressureQueue.length;
    if (count === 0) return;

    while (this.backpressureQueue.length > 0) {
      const fn = this.backpressureQueue.shift()!;
      await fn();
    }

    console.log(`[reconnect] 🚰 Drained ${count} queued operations`);
  }

  enqueue(fn: () => Promise<void>): void {
    this.backpressureQueue.push(fn);
    if (!this.isReconnecting) {
      this.drainQueue().catch(() => undefined);
    }
  }

  stop(): void {
    if (this.watchdogInterval !== null) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    console.log("[reconnect] ⏹️ ReconnectionManager stopped");
  }
}
