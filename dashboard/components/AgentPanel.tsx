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

const ACTION_COLOR: Record<AgentAction, string> = {
  RESUBMIT: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  REFRESH_BLOCKHASH: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  INCREASE_TIP: "bg-orange-500/10 border-orange-500/30 text-orange-400",
  WAIT_FOR_LEADER: "bg-gray-500/10 border-gray-500/30 text-gray-400",
  ABANDON: "bg-rose-500/10 border-rose-500/30 text-rose-400",
};

export default function AgentPanel() {
  const [decisions, setDecisions] = useState<AgentDecisionDisplay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Fetch initial agent decisions from database on load if any
    const fetchDecisions = async () => {
      try {
        const res = await fetch("http://localhost:3001/payments");
        const payments = await res.json();
        if (Array.isArray(payments)) {
          // If there are decisions, we can map them
          // For simplicity, websocket handles real-time feeds
        }
      } catch (err) {
        // ignore
      }
    };
    fetchDecisions();

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

        setDecisions((prev) => [decision, ...prev].slice(0, 5));
        setActiveId(id);

        // Typewriter animation
        let i = 0;
        if (animRef.current) clearInterval(animRef.current);
        animRef.current = setInterval(() => {
          i += 3;
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
        }, 10);
      }
    );

    return () => {
      unsub();
      if (animRef.current) clearInterval(animRef.current);
    };
  }, []);

  const active = decisions.find((d) => d.id === activeId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            AI Operations Agent
          </h2>
          {active && !active.animationDone && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
            </span>
          )}
        </div>
      </div>

      {!active ? (
        <div className="glass-card p-6 text-gray-500 text-xs flex flex-col items-center justify-center text-center space-y-2 border-dashed border-white/5">
          <span className="text-lg">⚙️</span>
          <span>Waiting for agent diagnosis... Failures will trigger the AI recovery agent.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active decision card */}
          <div className="glass-card p-4 border border-purple-500/20 bg-purple-500/[0.02]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono tracking-widest bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2.5 py-0.5 rounded-full uppercase">
                  {active.failureCode}
                </span>
                <span className="text-[10px] text-gray-500 font-mono">Attempt {active.attempt}</span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono">
                {Math.round((Date.now() - active.decidedAt) / 1000)}s ago
              </span>
            </div>

            <p className="text-sm text-gray-200 font-medium mb-3 leading-relaxed">
              {active.diagnosis}
            </p>

            {/* Recommended Action Badges */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {active.recommendedActions.map((action) => (
                <span
                  key={action}
                  className={`text-[9px] uppercase tracking-wider font-mono font-medium px-2 py-0.5 rounded border ${ACTION_COLOR[action] ?? "bg-gray-800 text-gray-200 border-white/5"}`}
                >
                  {action}
                </span>
              ))}
            </div>

            {/* Parameter adjustments */}
            <div className="bg-[#040407] rounded-lg border border-white/5 p-3 text-[11px] font-mono text-gray-400 space-y-2 mb-4">
              <div className="flex justify-between items-center">
                <span>Calculated Retry Tip:</span>
                <span className="text-emerald-400 font-semibold">{active.newTipLamports.toLocaleString()} lamports</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Blockhash Expiry Action:</span>
                <span className={active.shouldRefreshBlockhash ? "text-emerald-400" : "text-rose-400"}>
                  {active.shouldRefreshBlockhash ? "REFRESH BLOCKHASH" : "REUSE CURRENT"}
                </span>
              </div>
              <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                <div className="flex justify-between items-center text-[10px]">
                  <span>AI Agent Confidence:</span>
                  <span className="text-purple-400 font-bold">{Math.round(active.confidenceScore * 100)}%</span>
                </div>
                <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${active.confidenceScore * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Terminal Reasoning Box */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-gray-500">
                Agent Reasoning Stream
              </span>
              <div className="relative">
                <pre className="bg-black/80 text-emerald-400 text-[10px] p-3 rounded-lg border border-white/5 font-mono overflow-y-auto max-h-[140px] leading-relaxed whitespace-pre-wrap">
                  {active.displayedChain}
                  {!active.animationDone && (
                    <span className="animate-pulse inline-block w-1.5 h-3 bg-emerald-400 ml-0.5"></span>
                  )}
                </pre>
              </div>
            </div>
          </div>

          {/* Previous decisions */}
          {decisions.slice(1, 5).map((d) => (
            <div
              key={d.id}
              className="glass-card p-3 border border-white/5 flex items-center justify-between text-xs hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-gray-500">
                  {new Date(d.decidedAt).toLocaleTimeString()}
                </span>
                <span className="text-rose-400 font-mono font-medium">{d.failureCode}</span>
              </div>
              <span className="text-gray-400 font-mono text-[10px] uppercase">
                {d.recommendedActions[0] ?? "NONE"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
