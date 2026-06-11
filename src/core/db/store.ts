import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import type {
  AgentAction,
  AgentDecision,
  BundleSubmission,
  FailureCode,
  FailureEvent,
  LifecycleEvent,
  PaymentReceipt,
  PaymentRequest,
  PaymentStatus
} from "../../types/index";

type SqliteRow = Record<string, unknown>;

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

const toOptionalString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return toStringValue(value);
};

const toNumberValue = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  return Number(value);
};

const toBooleanValue = (value: unknown): boolean => toNumberValue(value) === 1;

const safeParseArray = <T>(value: unknown): T[] => {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const safeParseObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
};

export class LifecycleStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.migrate();
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    console.log(`[db]  SQLite store opened at ${dbPath}`);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        sender_pubkey TEXT NOT NULL,
        recipient_pubkey TEXT NOT NULL,
        amount_lamports INTEGER NOT NULL,
        token_mint TEXT NOT NULL,
        memo TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        inject_fault TEXT
      );

      CREATE TABLE IF NOT EXISTS bundle_submissions (
        bundle_id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id),
        signatures TEXT NOT NULL,
        tip_lamports INTEGER NOT NULL,
        tip_account TEXT NOT NULL,
        submitted_slot INTEGER NOT NULL,
        submitted_at INTEGER NOT NULL,
        blockhash TEXT NOT NULL,
        last_valid_block_height INTEGER NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS lifecycle_events (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id),
        bundle_id TEXT NOT NULL,
        status TEXT NOT NULL,
        slot INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        latency_from_previous_ms INTEGER,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS failure_events (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id),
        bundle_id TEXT NOT NULL,
        code TEXT NOT NULL,
        slot INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        raw_error TEXT NOT NULL,
        remediation_hint TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_decisions (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL REFERENCES payments(id),
        attempt INTEGER NOT NULL,
        failure_code TEXT NOT NULL,
        diagnosis TEXT NOT NULL,
        recommended_actions TEXT NOT NULL,
        new_tip_lamports INTEGER NOT NULL,
        should_refresh_blockhash INTEGER NOT NULL,
        should_abandon INTEGER NOT NULL,
        confidence_score REAL NOT NULL,
        reasoning_chain TEXT NOT NULL,
        decided_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_receipts (
        payment_id TEXT PRIMARY KEY REFERENCES payments(id),
        status TEXT NOT NULL,
        final_signature TEXT NOT NULL,
        tip_paid_lamports INTEGER NOT NULL,
        submitted_slot INTEGER NOT NULL,
        finalized_slot INTEGER NOT NULL,
        total_latency_ms INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        agent_invoked INTEGER NOT NULL,
        generated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_lifecycle_payment_id
        ON lifecycle_events(payment_id);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_status
        ON lifecycle_events(status);
      CREATE INDEX IF NOT EXISTS idx_bundle_payment_id
        ON bundle_submissions(payment_id);
      CREATE INDEX IF NOT EXISTS idx_failures_payment_id
        ON failure_events(payment_id);
    `);

    console.log("[db] ✅ Tables migrated successfully");
  }

  insertPayment(payment: PaymentRequest): void {
    this.db
      .prepare(
        `
          INSERT INTO payments (
            id,
            sender_pubkey,
            recipient_pubkey,
            amount_lamports,
            token_mint,
            memo,
            status,
            created_at,
            updated_at,
            inject_fault
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        payment.id,
        payment.senderPubkey,
        payment.recipientPubkey,
        payment.amountLamports,
        payment.tokenMint,
        payment.memo ?? null,
        "QUEUED",
        payment.createdAt,
        Date.now(),
        payment.injectFault ?? null
      );

    console.log(`[db]  Payment inserted: ${payment.id}`);
  }

  updatePaymentStatus(paymentId: string, status: PaymentStatus): void {
    this.db
      .prepare(
        `
          UPDATE payments
          SET status = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(status, Date.now(), paymentId);

    console.log(`[db]  Payment ${paymentId} → ${status}`);
  }

  insertBundleSubmission(bundle: BundleSubmission): void {
    this.db
      .prepare(
        `
          INSERT INTO bundle_submissions (
            bundle_id,
            payment_id,
            signatures,
            tip_lamports,
            tip_account,
            submitted_slot,
            submitted_at,
            blockhash,
            last_valid_block_height,
            attempt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        bundle.bundleId,
        bundle.paymentId,
        JSON.stringify(bundle.signatures),
        bundle.tipLamports,
        bundle.tipAccount,
        bundle.submittedSlot,
        bundle.submittedAt,
        bundle.blockhash,
        bundle.lastValidBlockHeight,
        bundle.attempt
      );

    console.log(
      `[db]  Bundle inserted: ${bundle.bundleId} (attempt ${bundle.attempt})`
    );
  }

  appendLifecycleEvent(event: LifecycleEvent): void {
    this.db
      .prepare(
        `
          INSERT INTO lifecycle_events (
            id,
            payment_id,
            bundle_id,
            status,
            slot,
            timestamp,
            latency_from_previous_ms,
            meta
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.paymentId,
        event.bundleId,
        event.status,
        event.slot,
        event.timestamp,
        event.latencyFromPreviousMs ?? null,
        event.meta === undefined ? null : JSON.stringify(event.meta)
      );

    console.log(
      `[db]  Event: ${event.paymentId} → ${event.status} at slot ${event.slot}`
    );
  }

  insertFailureEvent(failure: FailureEvent): void {
    this.db
      .prepare(
        `
          INSERT INTO failure_events (
            id,
            payment_id,
            bundle_id,
            code,
            slot,
            timestamp,
            raw_error,
            remediation_hint
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        randomUUID(),
        failure.paymentId,
        failure.bundleId,
        failure.code,
        failure.slot,
        failure.timestamp,
        failure.rawError,
        failure.remediationHint
      );

    console.log(`[db] ❌ Failure: ${failure.paymentId} — ${failure.code}`);
  }

  insertAgentDecision(
    paymentId: string,
    decision: AgentDecision,
    attempt: number,
    failureCode: FailureCode
  ): void {
    this.db
      .prepare(
        `
          INSERT INTO agent_decisions (
            id,
            payment_id,
            attempt,
            failure_code,
            diagnosis,
            recommended_actions,
            new_tip_lamports,
            should_refresh_blockhash,
            should_abandon,
            confidence_score,
            reasoning_chain,
            decided_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        randomUUID(),
        paymentId,
        attempt,
        failureCode,
        decision.diagnosis,
        JSON.stringify(decision.recommendedActions),
        decision.newTipLamports,
        decision.shouldRefreshBlockhash ? 1 : 0,
        decision.shouldAbandon ? 1 : 0,
        decision.confidenceScore,
        decision.reasoningChain,
        decision.decidedAt
      );

    console.log(
      `[db]  Agent decision saved: ${paymentId} (confidence: ${decision.confidenceScore})`
    );
  }

  insertReceipt(receipt: PaymentReceipt): void {
    this.db
      .prepare(
        `
          INSERT INTO payment_receipts (
            payment_id,
            status,
            final_signature,
            tip_paid_lamports,
            submitted_slot,
            finalized_slot,
            total_latency_ms,
            attempts,
            agent_invoked,
            generated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        receipt.paymentId,
        receipt.status,
        receipt.finalSignature,
        receipt.tipPaidLamports,
        receipt.submittedSlot,
        receipt.finalizedSlot,
        receipt.totalLatencyMs,
        receipt.attempts,
        receipt.agentInvoked ? 1 : 0,
        receipt.generatedAt
      );

    console.log(`[db]  Receipt saved: ${receipt.paymentId}`);
  }

  getPayment(paymentId: string): PaymentRequest | null {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            sender_pubkey,
            recipient_pubkey,
            amount_lamports,
            token_mint,
            memo,
            created_at,
            inject_fault
          FROM payments
          WHERE id = ?
        `
      )
      .get(paymentId) as SqliteRow | undefined;

    if (row === undefined) {
      return null;
    }

    return this.paymentFromRow(row);
  }

  getLifecycleEvents(paymentId: string): LifecycleEvent[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            payment_id,
            bundle_id,
            status,
            slot,
            timestamp,
            latency_from_previous_ms,
            meta
          FROM lifecycle_events
          WHERE payment_id = ?
          ORDER BY timestamp ASC
        `
      )
      .all(paymentId) as SqliteRow[];

    return rows.map((row) => this.lifecycleEventFromRow(row));
  }

  getBundleSubmissions(paymentId: string): BundleSubmission[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            bundle_id,
            payment_id,
            signatures,
            tip_lamports,
            tip_account,
            submitted_slot,
            submitted_at,
            blockhash,
            last_valid_block_height,
            attempt
          FROM bundle_submissions
          WHERE payment_id = ?
          ORDER BY submitted_at ASC
        `
      )
      .all(paymentId) as SqliteRow[];

    return rows.map((row) => this.bundleSubmissionFromRow(row));
  }

  getAgentDecisions(paymentId: string): AgentDecision[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            diagnosis,
            recommended_actions,
            new_tip_lamports,
            should_refresh_blockhash,
            should_abandon,
            confidence_score,
            reasoning_chain,
            decided_at
          FROM agent_decisions
          WHERE payment_id = ?
          ORDER BY decided_at ASC
        `
      )
      .all(paymentId) as SqliteRow[];

    return rows.map((row) => this.agentDecisionFromRow(row));
  }

  getFailures(paymentId: string): FailureEvent[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            payment_id,
            bundle_id,
            code,
            slot,
            timestamp,
            raw_error,
            remediation_hint
          FROM failure_events
          WHERE payment_id = ?
          ORDER BY timestamp ASC
        `
      )
      .all(paymentId) as SqliteRow[];

    return rows.map((row) => this.failureEventFromRow(row));
  }

  getReceipt(paymentId: string): PaymentReceipt | null {
    const row = this.db
      .prepare(
        `
          SELECT
            receipt.payment_id,
            receipt.status,
            payment.sender_pubkey,
            payment.recipient_pubkey,
            payment.amount_lamports,
            payment.token_mint,
            payment.memo,
            receipt.final_signature,
            receipt.tip_paid_lamports,
            receipt.submitted_slot,
            receipt.finalized_slot,
            receipt.total_latency_ms,
            receipt.attempts,
            receipt.agent_invoked,
            receipt.generated_at
          FROM payment_receipts receipt
          INNER JOIN payments payment
            ON payment.id = receipt.payment_id
          WHERE receipt.payment_id = ?
        `
      )
      .get(paymentId) as SqliteRow | undefined;

    if (row === undefined) {
      return null;
    }

    return this.paymentReceiptFromRow(row);
  }

  getAllPayments(limit = 50): PaymentRequest[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            id,
            sender_pubkey,
            recipient_pubkey,
            amount_lamports,
            token_mint,
            memo,
            created_at,
            inject_fault
          FROM payments
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(Math.max(0, Math.floor(limit))) as SqliteRow[];

    return rows.map((row) => this.paymentFromRow(row));
  }

  private paymentFromRow(row: SqliteRow): PaymentRequest {
    return {
      id: toStringValue(row.id),
      senderPubkey: toStringValue(row.sender_pubkey),
      recipientPubkey: toStringValue(row.recipient_pubkey),
      amountLamports: toNumberValue(row.amount_lamports),
      tokenMint: toStringValue(row.token_mint),
      memo: toOptionalString(row.memo),
      createdAt: toNumberValue(row.created_at),
      injectFault: toOptionalString(row.inject_fault) as
        | PaymentRequest["injectFault"]
        | undefined
    };
  }

  private bundleSubmissionFromRow(row: SqliteRow): BundleSubmission {
    return {
      bundleId: toStringValue(row.bundle_id),
      paymentId: toStringValue(row.payment_id),
      signatures: safeParseArray<string>(row.signatures),
      tipLamports: toNumberValue(row.tip_lamports),
      tipAccount: toStringValue(row.tip_account),
      submittedSlot: toNumberValue(row.submitted_slot),
      submittedAt: toNumberValue(row.submitted_at),
      blockhash: toStringValue(row.blockhash),
      lastValidBlockHeight: toNumberValue(row.last_valid_block_height),
      attempt: toNumberValue(row.attempt)
    };
  }

  private lifecycleEventFromRow(row: SqliteRow): LifecycleEvent {
    const event: LifecycleEvent = {
      id: toStringValue(row.id),
      paymentId: toStringValue(row.payment_id),
      bundleId: toStringValue(row.bundle_id),
      status: toStringValue(row.status) as PaymentStatus,
      slot: toNumberValue(row.slot),
      timestamp: toNumberValue(row.timestamp)
    };

    if (
      row.latency_from_previous_ms !== null &&
      row.latency_from_previous_ms !== undefined
    ) {
      event.latencyFromPreviousMs = toNumberValue(
        row.latency_from_previous_ms
      );
    }

    if (row.meta !== null && row.meta !== undefined) {
      event.meta = safeParseObject(row.meta);
    }

    return event;
  }

  private failureEventFromRow(row: SqliteRow): FailureEvent {
    return {
      paymentId: toStringValue(row.payment_id),
      bundleId: toStringValue(row.bundle_id),
      code: toStringValue(row.code) as FailureCode,
      slot: toNumberValue(row.slot),
      timestamp: toNumberValue(row.timestamp),
      rawError: toStringValue(row.raw_error),
      remediationHint: toStringValue(row.remediation_hint)
    };
  }

  private agentDecisionFromRow(row: SqliteRow): AgentDecision {
    return {
      diagnosis: toStringValue(row.diagnosis),
      recommendedActions: safeParseArray<AgentAction>(
        row.recommended_actions
      ),
      newTipLamports: toNumberValue(row.new_tip_lamports),
      shouldRefreshBlockhash: toBooleanValue(row.should_refresh_blockhash),
      shouldAbandon: toBooleanValue(row.should_abandon),
      confidenceScore: toNumberValue(row.confidence_score),
      reasoningChain: toStringValue(row.reasoning_chain),
      decidedAt: toNumberValue(row.decided_at)
    };
  }

  private paymentReceiptFromRow(row: SqliteRow): PaymentReceipt {
    return {
      paymentId: toStringValue(row.payment_id),
      status: toStringValue(row.status) as PaymentStatus,
      senderPubkey: toStringValue(row.sender_pubkey),
      recipientPubkey: toStringValue(row.recipient_pubkey),
      amountLamports: toNumberValue(row.amount_lamports),
      tokenMint: toStringValue(row.token_mint),
      memo: toOptionalString(row.memo),
      finalSignature: toStringValue(row.final_signature),
      tipPaidLamports: toNumberValue(row.tip_paid_lamports),
      submittedSlot: toNumberValue(row.submitted_slot),
      finalizedSlot: toNumberValue(row.finalized_slot),
      totalLatencyMs: toNumberValue(row.total_latency_ms),
      attempts: toNumberValue(row.attempts),
      agentInvoked: toBooleanValue(row.agent_invoked),
      generatedAt: toNumberValue(row.generated_at)
    };
  }
}

let storeInstance: LifecycleStore | null = null;

export const createStore = (dbPath: string): LifecycleStore => {
  if (storeInstance === null) {
    storeInstance = new LifecycleStore(dbPath);
  }

  return storeInstance;
};
