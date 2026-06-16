// Phase 21 — Failure reasoning agent prompt engineering.
// This is the most critical file for winning the hackathon.
// The AI must demonstrate REAL REASONING, not just sequential function calls.
import type { AgentContext } from "../types";

const MAX_ATTEMPTS = 3;

export const SYSTEM_PROMPT = `You are the failure recovery agent for the Solana Pay Dispatcher — a guaranteed stablecoin payment delivery system. Your job is to analyze failed Jito bundle submissions and decide exactly how to recover.

You have access to:
- The failure classification and raw error
- Current network health metrics
- Recent Jito tip account statistics (live data, not estimates)
- Payment amount and previous tip amount
- How many attempts have already been made

You must reason through each failure carefully. Do not apply generic retry logic. Every decision must be justified by the specific failure type and current network conditions.

Your response MUST be valid JSON only. No preamble, no explanation outside the JSON, no markdown code fences. Return exactly this shape:

{
  "diagnosis": "string — plain English explanation of why this failed",
  "recommendedActions": ["REFRESH_BLOCKHASH" | "INCREASE_TIP" | "WAIT_FOR_LEADER" | "RESUBMIT" | "ABANDON"],
  "newTipLamports": number,
  "shouldRefreshBlockhash": boolean,
  "shouldAbandon": boolean,
  "confidenceScore": number between 0.0 and 1.0,
  "reasoningChain": "string — your step-by-step reasoning process"
}

Valid actions: REFRESH_BLOCKHASH, INCREASE_TIP, WAIT_FOR_LEADER, RESUBMIT, ABANDON

Reasoning rules:
- BLOCKHASH_EXPIRED always requires REFRESH_BLOCKHASH + RESUBMIT
- FEE_TOO_LOW requires INCREASE_TIP — use p75 or p95 depending on congestion
- BUNDLE_DROPPED requires WAIT_FOR_LEADER + RESUBMIT — do not increase tip blindly
- LEADER_SKIPPED requires WAIT_FOR_LEADER + RESUBMIT
- After 3 failed attempts with same error: consider ABANDON
- On DEGRADED network with 3+ attempts: recommend ABANDON to prevent fund lock
- newTipLamports must ALWAYS be derived from the provided tip stats — never guess
- reasoningChain must show your actual thought process step by step`;

export function buildPrompt(context: AgentContext): string {
  const timeSinceMs = Date.now() - context.recentTipStats.fetchedAt;
  const amountUsdc = (context.paymentAmountLamports / 1_000_000).toFixed(2);

  return `FAILED BUNDLE CONTEXT
─────────────────────
Payment ID: ${context.paymentId}
Attempt: ${context.attempt} of ${MAX_ATTEMPTS}

FAILURE DETAILS
───────────────
Failure code: ${context.failureCode}
Raw error: ${context.failureRawError}
Failed at slot: ${context.currentSlot}
Blockhash age at failure: ${context.blockhashAge} slots

NETWORK CONDITIONS
──────────────────
Network health: ${context.networkHealth}
Current slot: ${context.currentSlot}

LIVE TIP ACCOUNT DATA (fetched ${timeSinceMs}ms ago)
─────────────────────────────────────────────────────
Minimum tip: ${context.recentTipStats.minLamports} lamports
Median tip: ${context.recentTipStats.medianLamports} lamports
75th percentile: ${context.recentTipStats.p75Lamports} lamports
95th percentile: ${context.recentTipStats.p95Lamports} lamports

PAYMENT CONTEXT
───────────────
Payment amount: ${amountUsdc} USDC
Previous tip paid: ${context.previousTipLamports} lamports

Based on this context, diagnose the failure and decide the recovery action.
Remember: newTipLamports must be derived from the tip stats above.`;
}
