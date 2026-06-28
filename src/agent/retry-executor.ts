// Phase 22 — Agent-driven retry executor.
import { PaymentStatus } from "../types";
import type { PaymentRequest } from "../types";
import type { AgentClient } from "./client";
import type { BundleConstructor } from "../core/bundle/bundle-constructor";
import type { BundleSubmitter } from "../core/bundle/submitter";
import type { FailureClassifier } from "../core/bundle/failure-classifier";
import type { LifecycleTracker } from "../core/lifecycle/tracker";
import type { LifecycleStore } from "../core/db/store";
import type { NetworkHealthMonitor } from "../core/stream/network-health";
import type { SolanaRpcClient } from "../core/rpc/client";
import type { TipFetcher } from "../core/bundle/tip-fetcher";
import { sleep } from "../core/rpc/client";

export class RetryExecutor {
  private readonly agentClient: AgentClient;
  private readonly bundleConstructor: BundleConstructor;
  private readonly bundleSubmitter: BundleSubmitter;
  private readonly failureClassifier: FailureClassifier;
  private readonly tracker: LifecycleTracker;
  private readonly store: LifecycleStore;
  private readonly healthMonitor: NetworkHealthMonitor;
  private readonly rpcClient: SolanaRpcClient;
  private readonly tipFetcher: TipFetcher;
  private readonly maxAttempts: number;
  private onDecision?: (paymentId: string, decision: unknown, attempt: number, failureCode: string) => void;

  constructor(
    agentClient: AgentClient,
    bundleConstructor: BundleConstructor,
    bundleSubmitter: BundleSubmitter,
    failureClassifier: FailureClassifier,
    tracker: LifecycleTracker,
    store: LifecycleStore,
    healthMonitor: NetworkHealthMonitor,
    rpcClient: SolanaRpcClient,
    tipFetcher: TipFetcher,
    maxAttempts = 3
  ) {
    this.agentClient = agentClient;
    this.bundleConstructor = bundleConstructor;
    this.bundleSubmitter = bundleSubmitter;
    this.failureClassifier = failureClassifier;
    this.tracker = tracker;
    this.store = store;
    this.healthMonitor = healthMonitor;
    this.rpcClient = rpcClient;
    this.tipFetcher = tipFetcher;
    this.maxAttempts = maxAttempts;
    console.log(`[retry] 🔁 RetryExecutor initialized (max attempts: ${maxAttempts})`);
  }

  setDecisionCallback(
    cb: (paymentId: string, decision: unknown, attempt: number, failureCode: string) => void
  ): void {
    this.onDecision = cb;
  }

  async handleFailure(
    error: unknown,
    payment: PaymentRequest,
    bundleId: string,
    previousTipLamports: number,
    attempt: number
  ): Promise<"retried" | "abandoned"> {
    const currentSlot = await this.rpcClient.getSlot().catch(() => 0);

    const failureEvent = this.failureClassifier.classify(
      error,
      payment.id,
      bundleId,
      currentSlot
    );

    this.store.insertFailureEvent(failureEvent);
    this.tracker.transition(
      payment.id,
      bundleId,
      PaymentStatus.FAILED,
      currentSlot
    );

    if (!this.failureClassifier.isRetryable(failureEvent.code) || attempt >= this.maxAttempts) {
      const reason = !this.failureClassifier.isRetryable(failureEvent.code)
        ? "not retryable"
        : "max attempts reached";
      console.log(`[retry] ❌ Abandoning payment ${payment.id}: ${reason}`);
      this.tracker.transition(
        payment.id,
        bundleId,
        PaymentStatus.ABANDONED,
        currentSlot
      );
      return "abandoned";
    }

    // Build context for AI agent
    const prevEvents = this.store.getLifecycleEvents(payment.id);
    const submittedEvent = prevEvents.find(
      (e) => e.status === PaymentStatus.SUBMITTED
    );
    const blockhashAge = submittedEvent
      ? currentSlot - submittedEvent.slot
      : 0;

    const context = {
      paymentId: payment.id,
      attempt,
      failureCode: failureEvent.code,
      failureRawError: failureEvent.rawError,
      currentSlot,
      networkHealth: this.healthMonitor.getStatus(),
      recentTipStats: this.tipFetcher.getStats(),
      paymentAmountLamports: payment.amountLamports,
      previousTipLamports,
      blockhashAge,
    };

    console.log(`[retry] 🤖 Consulting AI agent for payment ${payment.id.slice(0, 8)}...`);
    const decision = await this.agentClient.decide(context);

    this.store.insertAgentDecision(
      payment.id,
      decision,
      attempt,
      failureEvent.code
    );

    this.onDecision?.(payment.id, decision, attempt, failureEvent.code);

    console.log("[retry] 🧠 AGENT DECISION ─────────────────────");
    console.log(`[retry]    Diagnosis: ${decision.diagnosis}`);
    console.log(`[retry]    Actions: ${decision.recommendedActions.join(", ")}`);
    console.log(`[retry]    New tip: ${decision.newTipLamports} lamports`);
    console.log(`[retry]    Refresh blockhash: ${decision.shouldRefreshBlockhash ? "yes" : "no"}`);
    console.log(`[retry]    Confidence: ${decision.confidenceScore}`);
    console.log(`[retry]    Reasoning: ${decision.reasoningChain}`);
    console.log("[retry] ─────────────────────────────────────────");

    if (decision.shouldAbandon) {
      this.tracker.transition(
        payment.id,
        bundleId,
        PaymentStatus.ABANDONED,
        currentSlot
      );
      console.log("[retry] 🚫 Agent decided to abandon payment");
      return "abandoned";
    }

    await sleep(1000);

    // Build new bundle with agent's decision
    const newBlockhash = decision.shouldRefreshBlockhash
      ? await this.rpcClient.getLatestBlockhash()
      : undefined;

    if (decision.shouldRefreshBlockhash) {
      console.log("[retry] 🔄 Blockhash refreshed");
    }

    const { transactions, bundleId: newBundleId } = newBlockhash
      ? await this.bundleConstructor.buildBundleWithBlockhash(
          payment,
          decision.newTipLamports,
          newBlockhash
        )
      : await this.bundleConstructor.buildBundle(
          payment,
          decision.newTipLamports
        );

    const newSlot = await this.rpcClient.getSlot().catch(() => 0);
    const tipFetcher = this.tipFetcher;
    const tipAccount = tipFetcher.getRandomTipAccount();
    const bh = newBlockhash ?? (await this.rpcClient.getLatestBlockhash());

    const newSubmission = await this.bundleSubmitter.submitBundle(
      payment,
      transactions,
      newBundleId,
      decision.newTipLamports,
      tipAccount,
      bh,
      attempt + 1
    );

    this.tracker.transition(
      payment.id,
      newSubmission.bundleId,
      PaymentStatus.SUBMITTED,
      newSlot
    );

    if (process.env.SOLANA_NETWORK !== "mainnet-beta") {
      console.log(`[retry] 📡 Direct RPC broadcast fallback triggered for payment ${payment.id.slice(0, 8)}...`);
      for (const tx of transactions) {
        this.rpcClient.getConnection().sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        }).catch((err) => {
          console.warn(`[retry] ⚠️ Direct broadcast error: ${err.message}`);
        });
      }
    }

    console.log(`[retry] ✅ Retry submitted: attempt ${attempt + 1}`);
    return "retried";
  }
}
