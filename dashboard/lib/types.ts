// Frontend mirror of backend types — same shapes, no logic.

export type PaymentStatus =
  | "QUEUED"
  | "SUBMITTED"
  | "PROCESSED"
  | "CONFIRMED"
  | "FINALIZED"
  | "FAILED"
  | "ABANDONED";

export type FailureCode =
  | "BLOCKHASH_EXPIRED"
  | "FEE_TOO_LOW"
  | "COMPUTE_EXCEEDED"
  | "BUNDLE_DROPPED"
  | "LEADER_SKIPPED"
  | "SIMULATION_FAILED"
  | "UNKNOWN";

export type AgentAction =
  | "REFRESH_BLOCKHASH"
  | "INCREASE_TIP"
  | "WAIT_FOR_LEADER"
  | "RESUBMIT"
  | "ABANDON";

export type NetworkHealth = "HEALTHY" | "CONGESTED" | "DEGRADED";

export type WsEventType =
  | "payment:update"
  | "slot:update"
  | "agent:decision"
  | "network:health"
  | "bundle:submitted"
  | "bundle:failed"
  | "notification:retry";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
  timestamp: number;
}

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

export interface BundleSubmission {
  bundleId: string;
  paymentId: string;
  signatures: string[];
  tipLamports: number;
  tipAccount: string;
  submittedSlot: number;
  submittedAt: number;
  blockhash: string;
  lastValidBlockHeight: number;
  attempt: number;
}

export interface AgentDecision {
  diagnosis: string;
  recommendedActions: AgentAction[];
  newTipLamports: number;
  shouldRefreshBlockhash: boolean;
  shouldAbandon: boolean;
  confidenceScore: number;
  reasoningChain: string;
  decidedAt: number;
}

export interface NetworkHealthSnapshot {
  status: NetworkHealth;
  currentSlot: number;
  slotRate: number;
  confirmedToFinalizedDeltaMs: number;
  processedToConfirmedDeltaMs: number;
  measuredAt: number;
}

export interface LeaderWindow {
  validatorPubkey: string;
  isJitoValidator: boolean;
  slotStart: number;
  slotEnd: number;
  slotsUntilLeader: number;
}

export interface SlotUpdate {
  slot: number;
  commitment: "processed" | "confirmed" | "finalized";
  timestamp: number;
}
