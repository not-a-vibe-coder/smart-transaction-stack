"use client";
import { useEffect, useState, useRef } from "react";
import { onEvent } from "@/lib/ws-client";
import type { AgentAction } from "@/lib/types";

interface AgentDecisionDisplay {
  id: string;
  paymentId: string;
  attempt: number;
  failureCode: string;
  diagnosis: string;
  recommendedActions: AgentAction[];
  newTipLamports: number;
  shouldRefreshBlockhash: boolean;
  shouldAbandon: boolean;
  confidenceScore: number;
  reasoningChain: string;
  decidedAt: number;
  displayedChain: string;
  animationDone: boolean;
}

// User-friendly labels for technical action codes
const ACTION_FRIENDLY: Record<AgentAction, { label: string; color: string; icon: string }> = {
  RESUBMIT: {
    label: "Re-send Transaction",
    color: "bg-blue-500/10 border-blue-500/30 text-blue-300",
    icon: "🔄",
  },
  REFRESH_BLOCKHASH: {
    label: "Refresh Expiry Key",
    color: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    icon: "🔑",
  },
  INCREASE_TIP: {
    label: "Increase Fee",
    color: "bg-orange-500/10 border-orange-500/30 text-orange-300",
    icon: "💰",
  },
  WAIT_FOR_LEADER: {
    label: "Wait for Better Slot",
    color: "bg-gray-500/10 border-gray-500/30 text-gray-300",
    icon: "⏸️",
  },
  ABANDON: {
    label: "Give Up — Notify User",
    color: "bg-rose-500/10 border-rose-500/30 text-rose-300",
    icon: "🚫",
  },
};

// Human-readable failure codes
const FAILURE_FRIENDLY: Record<string, string> = {
  BLOCKHASH_EXPIRED: "Transaction key expired",
  FEE_TOO_LOW: "Fee was too low",
  COMPUTE_EXCEEDED: "Too much computation",
  BUNDLE_FAILED: "Bundle not accepted",
  UNKNOWN: "Unexpected failure",
};

export default function AgentPanel() {
  const [decisions, setDecisions] = useState<AgentDecisionDisplay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unsub = onEvent<Record<string, unknown>>(
      "agent:decision",
      (payload) => {
        const id = Math.random().toString(36).slice(2);
        const chain = String(payload.reasoningChain ?? "");

        const decision: AgentDecisionDisplay = {
          id,
          paymentId: String(payload.paymentId ?? ""),
          attempt: Number(payload.attempt ?? 1),
          failureCode: String(payload.failureCode ?? "UNKNOWN"),
          diagnosis: String(payload.diagnosis ?? ""),
          recommendedActions: (payload.recommendedActions as AgentAction[]) ?? [],
          newTipLamports: Number(payload.newTipLamports ?? 0),
          shouldRefreshBlockhash: Boolean(payload.shouldRefreshBlockhash),
          shouldAbandon: Boolean(payload.shouldAbandon),
          confidenceScore: Number(payload.confidenceScore ?? 0),
          reasoningChain: chain,
          decidedAt: Number(payload.decidedAt ?? Date.now()),
          displayedChain: "",
          animationDone: false,
        };

        setDecisions((prev) => [decision, ...prev].slice(0, 8));
        setActiveId(id);

        // Typewriter animation
        let i = 0;
        if (animRef.current) clearInterval(animRef.current);
        animRef.current = setInterval(() => {
          i += 4;
          setDecisions((prev) =>
            prev.map((d) =>
              d.id === id
                ? {
                    ...d,
                    displayedChain: chain.slice(0, i),
                    animationDone: i >= chain.length,
                  }
                : d
            )
          );
          if (i >= chain.length && animRef.current) {
            clearInterval(animRef.current);
          }
        }, 12);
      }
    );

    return () => {
      unsub();
      if (animRef.current) clearInterval(animRef.current);
    };
  }, []);

  const active = decisions.find((d) => d.id === activeId);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-white">🤖 AI Recovery Agent</h2>
          {active && !active.animationDone && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">
          {decisions.length} decision{decisions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {!active ? (
        <div className="glass-card p-8 text-center border-dashed flex flex-col items-center space-y-3">
          <span className="text-4xl">🛡️</span>
          <p className="text-gray-300 font-semibold text-base">AI Agent Standing By</p>
          <p className="text-gray-500 text-sm leading-relaxed">
            When a payment fails, the AI will automatically step in, figure out
            what went wrong, and retry it — no manual action needed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active decision */}
          <div className="glass-card p-5 border border-purple-500/25 bg-purple-500/[0.03]">
            {/* Status bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🔍</span>
                <span className="text-sm font-bold text-white">
                  {FAILURE_FRIENDLY[active.failureCode] ?? active.failureCode}
                </span>
                <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">
                  Retry #{active.attempt}
                </span>
              </div>
              <span className="text-xs text-gray-500">
                {Math.round((Date.now() - active.decidedAt) / 1000)}s ago
              </span>
            </div>

            {/* Plain-English Diagnosis */}
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 mb-4">
              <p className="text-sm text-gray-200 leading-relaxed">
                <span className="text-amber-400 font-semibold">What happened: </span>
                {active.diagnosis}
              </p>
            </div>

            {/* Action plan */}
            <div className="mb-4">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
                What the AI is doing:
              </p>
              <div className="flex flex-wrap gap-2">
                {active.recommendedActions.map((action) => {
                  const meta = ACTION_FRIENDLY[action];
                  return (
                    <span
                      key={action}
                      className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border ${meta?.color ?? "bg-gray-800 text-gray-200 border-white/5"}`}
                    >
                      <span>{meta?.icon}</span>
                      {meta?.label ?? action}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Parameter summary */}
            <div className="bg-black/30 rounded-xl border border-white/5 p-4 text-sm font-mono space-y-2 mb-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">New Fee (Retry Tip)</span>
                <span className="text-emerald-400 font-bold">
                  {active.newTipLamports.toLocaleString()} lamports
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Fresh Blockhash</span>
                <span
                  className={
                    active.shouldRefreshBlockhash
                      ? "text-emerald-400 font-bold"
                      : "text-gray-400"
                  }
                >
                  {active.shouldRefreshBlockhash ? "✅ Yes — Fetching new one" : "No — Reusing current"}
                </span>
              </div>
              <div className="pt-2 border-t border-white/5 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">AI Confidence</span>
                  <span className="text-purple-400 font-bold text-base">
                    {Math.round(active.confidenceScore * 100)}%
                  </span>
                </div>
                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-600 to-purple-400 h-2 rounded-full transition-all duration-700"
                    style={{ width: `${active.confidenceScore * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Reasoning stream */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
                AI Reasoning (live)
              </p>
              <pre className="bg-black/80 text-emerald-400 text-xs p-4 rounded-xl border border-white/5 font-mono overflow-y-auto max-h-[160px] leading-relaxed whitespace-pre-wrap">
                {active.displayedChain}
                {!active.animationDone && (
                  <span className="animate-pulse inline-block w-1.5 h-3.5 bg-emerald-400 ml-0.5 align-text-bottom" />
                )}
              </pre>
            </div>
          </div>

          {/* Previous decisions history */}
          {decisions.slice(1, 6).length > 0 && (
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-widest mb-2">
                Previous Interventions
              </p>
              {decisions.slice(1, 6).map((d) => {
                const meta = ACTION_FRIENDLY[d.recommendedActions[0]];
                return (
                  <div
                    key={d.id}
                    className="glass-card p-3 border border-white/5 flex items-center justify-between text-sm hover:bg-white/5 transition-colors mb-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 text-xs font-mono">
                        {new Date(d.decidedAt).toLocaleTimeString()}
                      </span>
                      <span className="text-rose-400 text-xs font-medium">
                        {FAILURE_FRIENDLY[d.failureCode] ?? d.failureCode}
                      </span>
                    </div>
                    <span className="text-gray-400 text-xs flex items-center gap-1">
                      {meta?.icon} {meta?.label ?? d.recommendedActions[0] ?? "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
