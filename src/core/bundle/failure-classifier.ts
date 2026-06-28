// Phase 16 — Failure classifier: error → FailureCode mapping.
import { FailureCode } from "../../types";
import type { FailureEvent } from "../../types";

export class FailureClassifier {
  constructor() {
    console.log("[classifier] 🔍 FailureClassifier initialized");
  }

  classify(
    error: unknown,
    paymentId: string,
    bundleId: string,
    slot: number
  ): FailureEvent {
    const raw =
      error instanceof Error ? error.message : String(error);
    const lower = raw.toLowerCase();

    let code: FailureCode;
    let remediationHint: string;

    if (
      lower.includes("blockhash not found") ||
      lower.includes("block height exceeded") ||
      lower.includes("expired") ||
      lower.includes("blockhash")
    ) {
      code = FailureCode.BLOCKHASH_EXPIRED;
      remediationHint =
        "Fetch a fresh blockhash with confirmed commitment and resubmit. Do not reuse the expired blockhash.";
    } else if (
      lower.includes("insufficient funds") ||
      lower.includes("fee too low") ||
      lower.includes("below minimum") ||
      lower.includes("insufficient lamports")
    ) {
      code = FailureCode.FEE_TOO_LOW;
      remediationHint =
        "Increase the transaction fee. Check current network priority fee requirements.";
    } else if (
      lower.includes("compute budget exceeded") ||
      lower.includes("exceeded cu") ||
      lower.includes("computebudget") ||
      lower.includes("compute units")
    ) {
      code = FailureCode.COMPUTE_EXCEEDED;
      remediationHint =
        "Add a ComputeBudgetProgram.setComputeUnitLimit instruction with a higher limit.";
    } else if (
      lower.includes("slot skip") ||
      lower.includes("leader skip") ||
      lower.includes("leader_skip")
    ) {
      code = FailureCode.LEADER_SKIPPED;
      remediationHint =
        "The scheduled Jito leader skipped their slot. Resubmit in the next available Jito leader window.";
    } else if (
      lower.includes("bundle") ||
      lower.includes("dropped") ||
      lower.includes("no leader") ||
      lower.includes("no_leader_window") ||
      lower.includes("leader window") ||
      lower.includes("jito leader")
    ) {
      code = FailureCode.BUNDLE_DROPPED;
      remediationHint =
        "The Jito leader may have skipped their slot. Wait for the next Jito leader window and resubmit.";
    } else if (
      lower.includes("simulation failed") ||
      lower.includes("simulationerror") ||
      lower.includes("simulation_failed")
    ) {
      code = FailureCode.SIMULATION_FAILED;
      remediationHint =
        "Transaction failed pre-flight simulation. Check account balances and instruction data.";
    } else {
      code = FailureCode.UNKNOWN;
      remediationHint =
        "Unknown failure. Check raw error and Solana explorer for transaction status.";
    }

    const event: FailureEvent = {
      paymentId,
      bundleId,
      code,
      slot,
      timestamp: Date.now(),
      rawError: raw,
      remediationHint,
    };

    console.log(
      `[classifier] ❌ Failure classified: ${code} — ${remediationHint.slice(0, 50)}`
    );

    return event;
  }

  isRetryable(code: FailureCode): boolean {
    const retryable = [
      FailureCode.BLOCKHASH_EXPIRED,
      FailureCode.FEE_TOO_LOW,
      FailureCode.BUNDLE_DROPPED,
      FailureCode.LEADER_SKIPPED,
    ].includes(code);

    console.log(
      `[classifier] 🔁 ${code} is ${retryable ? "retryable" : "NOT retryable"}`
    );

    return retryable;
  }
}
