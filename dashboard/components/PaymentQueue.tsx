"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { onEvent } from "@/lib/ws-client";
import type { PaymentStatus } from "@/lib/types";

interface PaymentCardData {
  paymentId: string;
  status: PaymentStatus;
  amountUsdc: number;
  recipientPubkey: string;
  memo?: string;
  currentSlot?: number;
  submittedSlot?: number;
  finalizedSlot?: number;
  latencyMs?: number;
  attempts: number;
  agentInvoked: boolean;
  updatedAt: number;
}

const STATUS_STAGES: PaymentStatus[] = [
  "QUEUED", "SUBMITTED", "PROCESSED", "CONFIRMED", "FINALIZED",
];

// Human-readable label + description for each status
const STATUS_META: Record<
  PaymentStatus,
  { label: string; desc: string; bg: string; text: string; dot: string; glow: string; icon: string }
> = {
  QUEUED: {
    label: "Waiting",
    desc: "Payment is in line",
    bg: "bg-gray-500/10 border-gray-500/20",
    text: "text-gray-300",
    dot: "bg-gray-400",
    glow: "shadow-gray-400/20",
    icon: "⏳",
  },
  SUBMITTED: {
    label: "Sent to Solana",
    desc: "Bundle submitted via Jito",
    bg: "bg-blue-500/10 border-blue-500/20",
    text: "text-blue-300",
    dot: "bg-blue-500",
    glow: "shadow-blue-500/30",
    icon: "📡",
  },
  PROCESSED: {
    label: "Processing",
    desc: "Network is handling it",
    bg: "bg-yellow-500/10 border-yellow-500/20",
    text: "text-yellow-300",
    dot: "bg-yellow-500",
    glow: "shadow-yellow-500/20",
    icon: "⚙️",
  },
  CONFIRMED: {
    label: "Confirmed",
    desc: "Accepted by validators",
    bg: "bg-orange-500/10 border-orange-500/20",
    text: "text-orange-300",
    dot: "bg-orange-500",
    glow: "shadow-orange-500/20",
    icon: "🔒",
  },
  FINALIZED: {
    label: "Complete ✓",
    desc: "Permanently on-chain",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    glow: "shadow-emerald-400/30",
    icon: "✅",
  },
  FAILED: {
    label: "Failed — Retrying",
    desc: "AI agent is recovering this",
    bg: "bg-rose-500/10 border-rose-500/20",
    text: "text-rose-300",
    dot: "bg-rose-500",
    glow: "shadow-rose-500/20",
    icon: "⚠️",
  },
  ABANDONED: {
    label: "Could Not Complete",
    desc: "AI notified — max retries reached",
    bg: "bg-red-950/30 border-red-800/30",
    text: "text-red-400",
    dot: "bg-red-700",
    glow: "shadow-red-900/10",
    icon: "🚫",
  },
};

function isActive(status: PaymentStatus): boolean {
  return ["QUEUED", "SUBMITTED", "PROCESSED", "CONFIRMED"].includes(status);
}

export default function PaymentQueue() {
  const [payments, setPayments] = useState<Map<string, PaymentCardData>>(new Map());

  useEffect(() => {
    fetch("http://localhost:3001/payments")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const map = new Map<string, PaymentCardData>();
          for (const p of data as Array<Record<string, unknown>>) {
            const id = String(p.id ?? "");
            map.set(id, {
              paymentId: id,
              status: (p.status as PaymentStatus) ?? "QUEUED",
              amountUsdc: Number(p.amountLamports ?? 0) / 1e6,
              recipientPubkey: String(p.recipientPubkey ?? ""),
              memo: p.memo as string | undefined,
              attempts: Number(p.attempts ?? 1),
              agentInvoked: Boolean(p.agentInvoked),
              updatedAt: Number(p.createdAt ?? Date.now()),
            });
          }
          setPayments(map);
        }
      })
      .catch(() => undefined);

    const unsub = onEvent<Record<string, unknown>>("payment:update", (payload) => {
      const id = String(payload.paymentId ?? payload.id ?? "");
      if (!id) return;
      setPayments((prev) => {
        const next = new Map(prev);
        const existing = next.get(id) ?? {
          paymentId: id,
          status: "QUEUED" as PaymentStatus,
          amountUsdc: 0,
          recipientPubkey: "",
          attempts: 1,
          agentInvoked: false,
          updatedAt: Date.now(),
        };
        next.set(id, {
          ...existing,
          status: (payload.status as PaymentStatus) ?? existing.status,
          amountUsdc:
            payload.amountUsdc !== undefined
              ? Number(payload.amountUsdc)
              : payload.amountLamports
              ? Number(payload.amountLamports) / 1e6
              : existing.amountUsdc,
          recipientPubkey: String(payload.recipientPubkey ?? existing.recipientPubkey),
          memo: (payload.memo as string | undefined) ?? existing.memo,
          finalizedSlot:
            (payload.finalizedSlot as number | undefined) ?? existing.finalizedSlot,
          submittedSlot:
            (payload.submittedSlot as number | undefined) ?? existing.submittedSlot,
          latencyMs:
            (payload.totalLatencyMs as number | undefined) ?? existing.latencyMs,
          agentInvoked: Boolean(payload.agentInvoked ?? existing.agentInvoked),
          attempts: Number(payload.attempts ?? existing.attempts),
          updatedAt: Date.now(),
        });
        return next;
      });
    });

    return () => { unsub(); };
  }, []);

  const all = [...payments.values()];
  const sorted = all
    .sort((a, b) => {
      const aActive = isActive(a.status) ? 0 : 1;
      const bActive = isActive(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 12);

  // Summary counts
  const counts = {
    total: all.length,
    finalized: all.filter((p) => p.status === "FINALIZED").length,
    failed: all.filter((p) => p.status === "FAILED").length,
    abandoned: all.filter((p) => p.status === "ABANDONED").length,
    active: all.filter((p) => isActive(p.status)).length,
    aiRecovered: all.filter((p) => p.agentInvoked && p.status === "FINALIZED").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="border-b border-white/5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-white">Payment Queue</h2>
          <span className="text-xs bg-white/5 text-gray-300 font-mono px-2.5 py-1 rounded-full border border-white/5">
            {counts.total} total
          </span>
        </div>

        {/* Summary bar */}
        {counts.total > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center bg-emerald-500/10 border border-emerald-500/20 rounded-lg py-2">
              <div className="text-lg font-bold text-emerald-400">{counts.finalized}</div>
              <div className="text-[10px] text-emerald-500/80 uppercase tracking-wider">Complete</div>
            </div>
            <div className="text-center bg-blue-500/10 border border-blue-500/20 rounded-lg py-2">
              <div className="text-lg font-bold text-blue-400">{counts.active}</div>
              <div className="text-[10px] text-blue-500/80 uppercase tracking-wider">In Progress</div>
            </div>
            <div className="text-center bg-purple-500/10 border border-purple-500/20 rounded-lg py-2">
              <div className="text-lg font-bold text-purple-400">{counts.aiRecovered}</div>
              <div className="text-[10px] text-purple-500/80 uppercase tracking-wider">AI Rescued</div>
            </div>
          </div>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="glass-card p-10 text-center border-dashed">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-400 text-base font-medium">No payments yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Press "Dispatch 12 Payments" above to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((p) => (
            <PaymentCard key={p.paymentId} card={p} />
          ))}
        </div>
      )}

      {all.length > 12 && (
        <Link
          href="/payments"
          className="block text-center text-sm text-blue-400 hover:text-blue-300 transition-colors py-2.5 border border-white/5 rounded-xl hover:bg-white/5"
        >
          View all {all.length} payments →
        </Link>
      )}
    </div>
  );
}

function PaymentCard({ card }: { card: PaymentCardData }) {
  const meta = STATUS_META[card.status] ?? STATUS_META.QUEUED;
  const stageIdx = STATUS_STAGES.indexOf(card.status);
  const isFailureState = card.status === "FAILED" || card.status === "ABANDONED";

  return (
    <div
      className={`glass-card glass-card-hover p-4 animate-in fade-in slide-in-from-bottom-2 duration-300 border ${meta.bg}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-white font-bold text-lg glow-text-blue">
            {card.amountUsdc.toFixed(2)}{" "}
            <span className="text-sm text-blue-400 font-normal">USDC</span>
          </span>
          <div className="text-xs text-gray-500 font-mono mt-0.5">
            To: {card.recipientPubkey.slice(0, 10)}…{card.recipientPubkey.slice(-4)}
          </div>
        </div>
        <div className="text-right">
          <div className={`flex items-center gap-1.5 ${meta.text}`}>
            <span className="text-base">{meta.icon}</span>
            <span className="text-sm font-semibold">{meta.label}</span>
          </div>
          <div className="text-xs text-gray-600 mt-0.5">{meta.desc}</div>
        </div>
      </div>

      {/* Memo */}
      {card.memo && (
        <div className="text-xs text-gray-500 italic border-l-2 border-white/10 pl-2 mb-3">
          {card.memo}
        </div>
      )}

      {/* AI Recovery badge when agent intervened */}
      {card.agentInvoked && card.status !== "ABANDONED" && (
        <div className="mb-3 flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-1.5">
          <span className="text-base">🤖</span>
          <span className="text-xs text-purple-300 font-medium">
            AI agent detected the failure and retried automatically
            {card.attempts > 1 ? ` (attempt ${card.attempts})` : ""}
          </span>
        </div>
      )}

      {/* Abandoned — user notification */}
      {card.status === "ABANDONED" && (
        <div className="mb-3 flex items-center gap-2 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
          <span className="text-base">🔔</span>
          <span className="text-xs text-red-400 font-medium">
            The AI tried {card.attempts} time{card.attempts !== 1 ? "s" : ""} but
            could not complete this payment. Please check the recipient wallet or
            network conditions.
          </span>
        </div>
      )}

      {/* Progress timeline */}
      {!isFailureState && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-gray-600 font-mono uppercase tracking-wider mb-2">
            <span>Queued</span>
            <span>Sent</span>
            <span>Processing</span>
            <span>Confirmed</span>
            <span>Done</span>
          </div>
          <div className="relative flex items-center justify-between">
            <div className="absolute left-0 right-0 h-[2px] bg-white/5 z-0" />
            <div
              className="absolute left-0 h-[2px] bg-gradient-to-r from-blue-500 to-emerald-400 z-0 transition-all duration-700"
              style={{
                width: `${(stageIdx / (STATUS_STAGES.length - 1)) * 100}%`,
              }}
            />
            {STATUS_STAGES.map((stage, idx) => {
              const filled = idx <= stageIdx;
              const active = idx === stageIdx;
              return (
                <div key={stage} className="relative z-10">
                  <div
                    className={`w-3 h-3 rounded-full transition-all duration-300 flex items-center justify-center ${
                      filled
                        ? "bg-emerald-400 shadow-md shadow-emerald-400/30"
                        : "bg-[#0d0d11] border border-white/10"
                    } ${active ? "ring-4 ring-emerald-400/25 scale-125" : ""}`}
                  >
                    {filled && <div className="w-1 h-1 bg-[#020204] rounded-full" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer stats for finalized */}
      {card.status === "FINALIZED" && (
        <div className="flex items-center justify-between text-xs border-t border-white/5 pt-3 mt-3 text-gray-500 font-mono">
          <div className="flex items-center gap-3">
            {card.finalizedSlot && <span>Slot {card.finalizedSlot.toLocaleString()}</span>}
            {card.latencyMs && (
              <span>
                Speed:{" "}
                <span className="text-gray-300 font-semibold">{card.latencyMs}ms</span>
              </span>
            )}
            <span>
              Attempts: <span className="text-gray-300 font-semibold">{card.attempts}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
