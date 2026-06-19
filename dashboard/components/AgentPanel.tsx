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
  RESUBMIT: "bg-blue-700 text-blue-100",
  REFRESH_BLOCKHASH: "bg-yellow-700 text-yellow-100",
  INCREASE_TIP: "bg-orange-700 text-orange-100",
  WAIT_FOR_LEADER: "bg-gray-700 text-gray-200",
  ABANDON: "bg-red-800 text-red-100",
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

        setDecisions((prev) => [decision, ...prev].slice(0, 5));
        setActiveId(id);

        // Typewriter animation
        let i = 0;
        if (animRef.current) clearInterval(animRef.current);
        animRef.current = setInterval(() => {
          i += 3; // 3 chars per tick ≈ ~30ms per char
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
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          AI Agent
        </h2>
        {active && !active.animationDone && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
          </span>
        )}
      </div>

      {!active ? (
        <p className="text-gray-600 text-sm">
          Waiting for agent decisions... Failures trigger the AI recovery agent.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Active decision */}
          <div className="bg-gray-900 border border-purple-800/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded font-mono">
                {active.failureCode}
              </span>
              <span className="text-xs text-gray-500">attempt {active.attempt}</span>
            </div>

            <p className="text-sm text-white mb-3">{active.diagnosis}</p>

            <div className="flex flex-wrap gap-1 mb-3">
              {active.recommendedActions.map((action) => (
                <span
                  key={action}
                  className={`text-xs px-2 py-0.5 rounded ${ACTION_COLOR[action] ?? "bg-gray-700 text-gray-200"}`}
                >
                  {action}
                </span>
              ))}
            </div>

            <div className="text-xs text-gray-400 space-y-1 mb-3">
              <div>
                New tip:{" "}
                <span className="text-white">{active.newTipLamports.toLocaleString()} lamports</span>
              </div>
              <div>
                Refresh blockhash:{" "}
                <span className={active.shouldRefreshBlockhash ? "text-green-400" : "text-red-400"}>
                  {active.shouldRefreshBlockhash ? "✓ Yes" : "✗ No"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>Confidence:</span>
                <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${active.confidenceScore * 100}%` }}
                  />
                </div>
                <span className="text-white">{Math.round(active.confidenceScore * 100)}%</span>
              </div>
            </div>

            <div className="border-t border-gray-800 pt-3">
              <p className="text-xs text-gray-500 mb-1.5">Reasoning chain:</p>
              <pre className="bg-[#111] text-green-400 text-xs p-3 rounded font-mono overflow-auto max-h-32 leading-relaxed whitespace-pre-wrap">
                {active.displayedChain}
                {!active.animationDone && (
                  <span className="animate-pulse">▌</span>
                )}
              </pre>
            </div>

            <p className="text-xs text-gray-600 mt-2">
              Decided {Math.round((Date.now() - active.decidedAt) / 1000)}s ago
            </p>
          </div>

          {/* Previous decisions */}
          {decisions.slice(1, 5).map((d) => (
            <div
              key={d.id}
              className="bg-gray-900/50 border border-gray-800 rounded px-3 py-2 text-xs text-gray-500 flex items-center gap-2"
            >
              <span className="font-mono text-gray-600">
                {new Date(d.decidedAt).toLocaleTimeString()}
              </span>
              <span className="text-red-400">{d.failureCode}</span>
              <span>→</span>
              <span>{d.recommendedActions[0] ?? "NONE"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
