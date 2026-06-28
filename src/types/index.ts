// ─── ENUMS ──────────────────────────────────────────────────────────────────

/** Solana cluster the dispatcher is pointed at. */
export enum Network {
  DEVNET = "devnet",
  MAINNET = "mainnet-beta"
}

/** Lifecycle status of a payment as it moves from queue to finality. */
export enum PaymentStatus {
  QUEUED = "QUEUED",
  SUBMITTED = "SUBMITTED",
  PROCESSED = "PROCESSED",
  CONFIRMED = "CONFIRMED",
  FINALIZED = "FINALIZED",
  FAILED = "FAILED",
  ABANDONED = "ABANDONED"
}

/** Categorized reason a bundle or transaction failed to land. */
export enum FailureCode {
  BLOCKHASH_EXPIRED = "BLOCKHASH_EXPIRED",
  FEE_TOO_LOW = "FEE_TOO_LOW",
  COMPUTE_EXCEEDED = "COMPUTE_EXCEEDED",
  BUNDLE_DROPPED = "BUNDLE_DROPPED",
  LEADER_SKIPPED = "LEADER_SKIPPED",
  SIMULATION_FAILED = "SIMULATION_FAILED",
  UNKNOWN = "UNKNOWN"
}

/** Remediation action the AI recovery agent can recommend. */
export enum AgentAction {
  REFRESH_BLOCKHASH = "REFRESH_BLOCKHASH",
  INCREASE_TIP = "INCREASE_TIP",
  WAIT_FOR_LEADER = "WAIT_FOR_LEADER",
  RESUBMIT = "RESUBMIT",
  ABANDON = "ABANDON"
}

/** Coarse classification of current network conditions. */
export enum NetworkHealth {
  HEALTHY = "HEALTHY",
  CONGESTED = "CONGESTED",
  DEGRADED = "DEGRADED"
}

/** Fault to deliberately inject for testing recovery paths. */
export enum FaultType {
  BLOCKHASH = "blockhash",
  LOW_FEE = "low_fee",
  LEADER_SKIP = "leader_skip",
  NONE = "none"
}

// ─── CORE PAYMENT TYPES ─────────────────────────────────────────────────────

/** A user's intent to send a stablecoin payment, before any submission. */
export interface PaymentRequest {
  id: string; // uuid generated at creation
  senderPubkey: string;
  recipientPubkey: string;
  amountLamports: number; // raw lamports, not UI amount
  tokenMint: string; // USDC or USDG mint address
  memo?: string; // optional reference e.g. "rent payment"
  createdAt: number; // unix timestamp ms
  injectFault?: FaultType; // for testing only
}

/** A Jito bundle submission carrying one payment's transactions. */
export interface BundleSubmission {
  bundleId: string; // uuid
  paymentId: string; // links back to PaymentRequest.id
  signatures: string[]; // all tx signatures in the bundle
  tipLamports: number;
  tipAccount: string;
  submittedSlot: number;
  submittedAt: number; // unix timestamp ms
  blockhash: string;
  lastValidBlockHeight: number;
  attempt: number; // 1 for first try, increments on retry
}

/** A single observed transition in a payment's lifecycle. */
export interface LifecycleEvent {
  id: string; // uuid
  paymentId: string;
  bundleId: string;
  status: PaymentStatus;
  slot: number;
  timestamp: number; // unix timestamp ms
  latencyFromPreviousMs?: number; // delta from last event
  meta?: Record<string, unknown>; // any extra data for that stage
}

/** A recorded failure with a categorized code and remediation hint. */
export interface FailureEvent {
  paymentId: string;
  bundleId: string;
  code: FailureCode;
  slot: number;
  timestamp: number;
  rawError: string;
  remediationHint: string; // human readable suggestion
}

// ─── AI AGENT TYPES ─────────────────────────────────────────────────────────

/** Full situational input handed to the AI agent when a payment fails. */
export interface AgentContext {
  paymentId: string;
  attempt: number;
  failureCode: FailureCode;
  failureRawError: string;
  currentSlot: number;
  networkHealth: NetworkHealth;
  recentTipStats: TipStats;
  paymentAmountLamports: number;
  previousTipLamports: number;
  blockhashAge: number; // slots since blockhash was fetched
}

/** The agent's structured verdict on how to recover a failed payment. */
export interface AgentDecision {
  diagnosis: string; // plain english: why it failed
  recommendedActions: AgentAction[];
  newTipLamports: number;
  shouldRefreshBlockhash: boolean;
  shouldAbandon: boolean;
  confidenceScore: number; // 0.0 to 1.0
  reasoningChain: string; // full chain of thought from the model
  decidedAt: number; // unix timestamp ms
}

// ─── JITO / NETWORK TYPES ───────────────────────────────────────────────────

/** Recent Jito tip distribution used to size a competitive tip. */
export interface TipStats {
  minLamports: number;
  medianLamports: number;
  p75Lamports: number;
  p95Lamports: number;
  fetchedAt: number; // unix timestamp ms
}

/** A slot notification streamed from the validator at a given commitment. */
export interface SlotUpdate {
  slot: number;
  commitment: "processed" | "confirmed" | "finalized";
  timestamp: number;
}

/** The upcoming leader schedule window for a validator. */
export interface LeaderWindow {
  validatorPubkey: string;
  isJitoValidator: boolean;
  slotStart: number;
  slotEnd: number;
  slotsUntilLeader: number;
}

/** A point-in-time measurement of network throughput and confirmation lag. */
export interface NetworkHealthSnapshot {
  status: NetworkHealth;
  currentSlot: number;
  slotRate: number; // slots per second, should be ~2.5
  confirmedToFinalizedDeltaMs: number;
  processedToConfirmedDeltaMs: number;
  measuredAt: number;
}

// ─── RECEIPT / OUTPUT TYPES ─────────────────────────────────────────────────

/** Final, user-facing record of a completed (or abandoned) payment. */
export interface PaymentReceipt {
  paymentId: string;
  status: PaymentStatus;
  senderPubkey: string;
  recipientPubkey: string;
  amountLamports: number;
  tokenMint: string;
  memo?: string;
  finalSignature: string;
  tipPaidLamports: number;
  submittedSlot: number;
  finalizedSlot: number;
  totalLatencyMs: number;
  attempts: number;
  agentInvoked: boolean;
  generatedAt: number;
}

// ─── WEBSOCKET EVENT TYPES (consumed by dashboard) ──────────────────────────

/** Pre-send validation of a recipient Solana address. */
export interface RecipientValidation {
  address: string;
  isValid: boolean;
  isEVMAddress: boolean;
  hasOnChainHistory: boolean;
  network: Network;
  warningMessage?: string;
}

/** Discriminator for the kind of event pushed over the dashboard WebSocket. */
export type WsEventType =
  | "payment:update"
  | "slot:update"
  | "agent:decision"
  | "network:health"
  | "bundle:submitted"
  | "bundle:failed"
  | "notification:retry"
  | "batch:started";

/** Envelope wrapping any payload broadcast to dashboard WebSocket clients. */
export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: number;
}

// This file is the single source of truth for all shared types.
//  Import from here, never redefine types in other modules.
