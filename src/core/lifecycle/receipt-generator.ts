// Phase 19 — Payment receipt generator.
import fs from "fs";
import path from "path";
import { PaymentStatus } from "../../types";
import type { PaymentReceipt, PaymentRequest } from "../../types";
import type { LifecycleStore } from "../db/store";

export class ReceiptGenerator {
  private readonly store: LifecycleStore;
  private readonly receiptsDir: string;

  constructor(store: LifecycleStore, receiptsDir = "./logs/receipts") {
    this.store = store;
    this.receiptsDir = receiptsDir;
    fs.mkdirSync(receiptsDir, { recursive: true });
    console.log(`[receipt] 🧾 ReceiptGenerator initialized at ${receiptsDir}`);
  }

  generateReceipt(
    payment: PaymentRequest,
    finalSignature: string
  ): PaymentReceipt | null {
    const events = this.store.getLifecycleEvents(payment.id);
    const finalizedEvent = events.find(
      (e) => e.status === PaymentStatus.FINALIZED
    );

    if (!finalizedEvent) {
      console.warn(
        `[receipt] ⚠️ No FINALIZED event for payment ${payment.id} — cannot generate receipt`
      );
      return null;
    }

    const submittedEvent = events.find(
      (e) => e.status === PaymentStatus.SUBMITTED
    );

    const bundles = this.store.getBundleSubmissions(payment.id);
    const agentDecisions = this.store.getAgentDecisions(payment.id);
    const lastBundle = bundles[bundles.length - 1];

    const receipt: PaymentReceipt = {
      paymentId: payment.id,
      status: PaymentStatus.FINALIZED,
      senderPubkey: payment.senderPubkey,
      recipientPubkey: payment.recipientPubkey,
      amountLamports: payment.amountLamports,
      tokenMint: payment.tokenMint,
      memo: payment.memo,
      finalSignature,
      tipPaidLamports: lastBundle?.tipLamports ?? 0,
      submittedSlot: submittedEvent?.slot ?? finalizedEvent.slot,
      finalizedSlot: finalizedEvent.slot,
      totalLatencyMs:
        finalizedEvent.timestamp -
        (submittedEvent?.timestamp ?? finalizedEvent.timestamp),
      attempts: bundles.length || 1,
      agentInvoked: agentDecisions.length > 0,
      generatedAt: Date.now(),
    };

    this.store.insertReceipt(receipt);

    const filePath = path.join(this.receiptsDir, `${payment.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2));

    console.log(
      `[receipt] ✅ Receipt generated: ${payment.id} ${payment.amountLamports / 1e6} USDC in ${receipt.totalLatencyMs}ms (${receipt.submittedSlot} → ${receipt.finalizedSlot})`
    );

    return receipt;
  }

  printReceiptSummary(receipt: PaymentReceipt): void {
    const lines = [
      "┌─────────────────────────────────────┐",
      "│  PAYMENT RECEIPT                    │",
      `│  ID: ${receipt.paymentId.slice(0, 16)}...        │`,
      `│  Amount: ${(receipt.amountLamports / 1e6).toFixed(2)} USDC              │`,
      `│  To: ${receipt.recipientPubkey.slice(0, 8)}...         │`,
      `│  Signature: ${receipt.finalSignature.slice(0, 16)}...       │`,
      `│  Submitted slot: ${receipt.submittedSlot}             │`,
      `│  Finalized slot: ${receipt.finalizedSlot}             │`,
      `│  Total time: ${receipt.totalLatencyMs}ms                 │`,
      `│  Tip paid: ${receipt.tipPaidLamports} lamports      │`,
      `│  Attempts: ${receipt.attempts}                      │`,
      `│  AI agent invoked: ${receipt.agentInvoked ? "yes" : "no"}         │`,
      "└─────────────────────────────────────┘",
    ];
    for (const line of lines) {
      console.log(line);
    }
  }
}
