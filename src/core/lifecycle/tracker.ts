// Phase 17 — Transaction lifecycle tracker (state machine).
import { randomUUID } from "crypto";
import { EventEmitter } from "eventemitter3";
import { PaymentStatus } from "../../types";
import type { LifecycleEvent, PaymentRequest } from "../../types";
import type { LifecycleStore } from "../db/store";

interface TrackerEvents {
  statusChange: (
    paymentId: string,
    status: PaymentStatus,
    event: LifecycleEvent
  ) => void;
}

// Legal state machine transitions
const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.QUEUED]: [PaymentStatus.QUEUED, PaymentStatus.SUBMITTED, PaymentStatus.FAILED],
  [PaymentStatus.SUBMITTED]: [PaymentStatus.SUBMITTED, PaymentStatus.PROCESSED, PaymentStatus.CONFIRMED, PaymentStatus.FINALIZED, PaymentStatus.FAILED],
  [PaymentStatus.PROCESSED]: [PaymentStatus.PROCESSED, PaymentStatus.CONFIRMED, PaymentStatus.FINALIZED, PaymentStatus.FAILED],
  [PaymentStatus.CONFIRMED]: [PaymentStatus.CONFIRMED, PaymentStatus.FINALIZED, PaymentStatus.FAILED],
  [PaymentStatus.FINALIZED]: [PaymentStatus.FINALIZED],
  [PaymentStatus.FAILED]: [PaymentStatus.FAILED, PaymentStatus.SUBMITTED, PaymentStatus.ABANDONED],
  [PaymentStatus.ABANDONED]: [PaymentStatus.ABANDONED],
};

export class LifecycleTracker extends EventEmitter<TrackerEvents> {
  private readonly store: LifecycleStore;
  private activePayments = new Map<string, PaymentStatus>();

  constructor(store: LifecycleStore) {
    super();
    this.store = store;
    console.log("[tracker] 📋 LifecycleTracker initialized");
  }

  trackNewPayment(payment: PaymentRequest): void {
    this.store.insertPayment(payment);
    this.activePayments.set(payment.id, PaymentStatus.QUEUED);

    const event: LifecycleEvent = {
      id: randomUUID(),
      paymentId: payment.id,
      bundleId: "none",
      status: PaymentStatus.QUEUED,
      slot: 0,
      timestamp: Date.now(),
    };
    this.store.appendLifecycleEvent(event);

    console.log(`[tracker] 📥 Tracking payment: ${payment.id} (QUEUED)`);
  }

  transition(
    paymentId: string,
    bundleId: string,
    newStatus: PaymentStatus,
    slot: number,
    meta?: Record<string, unknown>
  ): void {
    const current = this.activePayments.get(paymentId);

    if (current === undefined) {
      console.warn(`[tracker] ⚠️ Unknown payment: ${paymentId}`);
      return;
    }

    const allowed = ALLOWED_TRANSITIONS[current] ?? [];
    if (!allowed.includes(newStatus) && newStatus !== PaymentStatus.ABANDONED) {
      console.warn(
        `[tracker] ⚠️ Illegal transition ${current} → ${newStatus} for ${paymentId}`
      );
      return;
    }

    // Compute latency from previous event
    const prevEvents = this.store.getLifecycleEvents(paymentId);
    const lastEvent = prevEvents[prevEvents.length - 1];
    const latencyFromPreviousMs = lastEvent
      ? Date.now() - lastEvent.timestamp
      : undefined;

    const event: LifecycleEvent = {
      id: randomUUID(),
      paymentId,
      bundleId,
      status: newStatus,
      slot,
      timestamp: Date.now(),
      latencyFromPreviousMs,
      meta,
    };

    this.store.appendLifecycleEvent(event);
    this.store.updatePaymentStatus(paymentId, newStatus);
    this.activePayments.set(paymentId, newStatus);
    this.emit("statusChange", paymentId, newStatus, event);

    console.log(
      `[tracker] 🔄 ${paymentId.slice(0, 8)} → ${newStatus} at slot ${slot} (Δ${latencyFromPreviousMs ?? 0}ms)`
    );
  }

  getStatus(paymentId: string): PaymentStatus | null {
    return this.activePayments.get(paymentId) ?? null;
  }

  isActive(paymentId: string): boolean {
    const status = this.activePayments.get(paymentId);
    return (
      status === PaymentStatus.QUEUED ||
      status === PaymentStatus.SUBMITTED ||
      status === PaymentStatus.PROCESSED ||
      status === PaymentStatus.CONFIRMED
    );
  }

  getEvents(paymentId: string): LifecycleEvent[] {
    return this.store.getLifecycleEvents(paymentId);
  }
}
