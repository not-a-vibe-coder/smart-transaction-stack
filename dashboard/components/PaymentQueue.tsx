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

const STATUS_STYLE: Record<PaymentStatus, { bg: string; text: string; dot: string; glow: string }> = {
  QUEUED: { bg: "bg-gray-500/10 border-gray-500/20", text: "text-gray-400", dot: "bg-gray-400", glow: "shadow-gray-400/20" },
  SUBMITTED: { bg: "bg-blue-500/10 border-blue-500/20", text: "text-blue-400", dot: "bg-blue-500", glow: "shadow-blue-500/20" },
  PROCESSED: { bg: "bg-yellow-500/10 border-yellow-500/20", text: "text-yellow-400", dot: "bg-yellow-500", glow: "shadow-yellow-500/20" },
  CONFIRMED: { bg: "bg-orange-500/10 border-orange-500/20", text: "text-orange-400", dot: "bg-orange-500", glow: "shadow-orange-500/20" },
  FINALIZED: { bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400", dot: "bg-emerald-400", glow: "shadow-emerald-400/20" },
  FAILED: { bg: "bg-red-500/10 border-red-500/20", text: "text-red-400", dot: "bg-red-500", glow: "shadow-red-500/20" },
  ABANDONED: { bg: "bg-red-950/20 border-red-950/30", text: "text-red-600", dot: "bg-red-900", glow: "shadow-red-900/10" },
};

function isActive(status: PaymentStatus): boolean {
  return ["QUEUED", "SUBMITTED", "PROCESSED", "CONFIRMED"].includes(status);
}

export default function PaymentQueue() {
  const [payments, setPayments] = useState<Map<string, PaymentCardData>>(
    new Map()
  );

  useEffect(() => {
    // Fetch initial payments from REST
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
              amountUsdc: (Number(p.amountLamports ?? 0)) / 1e6,
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

    // Subscribe to live updates
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
          recipientPubkey:
            String(payload.recipientPubkey ?? existing.recipientPubkey),
          memo: (payload.memo as string | undefined) ?? existing.memo,
          finalizedSlot: payload.finalizedSlot as number | undefined ?? existing.finalizedSlot,
          submittedSlot: payload.submittedSlot as number | undefined ?? existing.submittedSlot,
          latencyMs: payload.totalLatencyMs as number | undefined ?? existing.latencyMs,
          agentInvoked: Boolean(payload.agentInvoked ?? existing.agentInvoked),
          attempts: Number(payload.attempts ?? existing.attempts),
          updatedAt: Date.now(),
        });
        return next;
      });
    });

    return () => { unsub(); };
  }, []);

  const sorted = [...payments.values()].sort((a, b) => {
    const aActive = isActive(a.status) ? 0 : 1;
    const bActive = isActive(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.updatedAt - a.updatedAt;
  }).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Payment Queue
          </h2>
          <span className="text-[10px] bg-white/5 text-gray-300 font-mono px-2 py-0.5 rounded-full border border-white/5">
            {payments.size} Total
          </span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="glass-card p-8 text-center text-gray-500 text-sm">
          No payments yet — dispatch one via POST /dispatch
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((p) => (
            <PaymentCard key={p.paymentId} card={p} />
          ))}
        </div>
      )}

      {payments.size > 10 && (
        <Link
          href="/payments"
          className="block text-center text-xs text-blue-400 hover:text-blue-300 transition-colors py-2 border border-white/5 rounded-lg hover:bg-white/5"
        >
          View all {payments.size} payments →
        </Link>
      )}
    </div>
  );
}

function PaymentCard({ card }: { card: PaymentCardData }) {
  const style = STATUS_STYLE[card.status] ?? STATUS_STYLE.QUEUED;
  const stageIdx = STATUS_STAGES.indexOf(card.status);

  return (
    <div className="glass-card glass-card-hover p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Top row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-semibold tracking-tight text-base glow-text-blue">
          {card.amountUsdc.toFixed(2)} <span className="text-xs text-blue-400 font-normal">USDC</span>
        </span>
        <span
          className={`text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-full border ${style.bg} ${style.text}`}
        >
          {card.status}
        </span>
      </div>

      {/* Middle row */}
      <div className="text-xs text-gray-400 mb-4 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-gray-500">To: {card.recipientPubkey.slice(0, 12)}...{card.recipientPubkey.slice(-4)}</span>
        </div>
        {card.memo && (
          <span className="italic text-gray-500 border-l border-white/10 pl-2 mt-1">{card.memo}</span>
        )}
      </div>

      {/* Timeline progress line */}
      {card.status !== "FAILED" && card.status !== "ABANDONED" && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[9px] text-gray-500 font-mono uppercase tracking-wider mb-2">
            <span>Queued</span>
            <span>Submitted</span>
            <span>Processed</span>
            <span>Confirmed</span>
            <span>Finalized</span>
          </div>
          <div className="relative flex items-center justify-between">
            {/* Background line */}
            <div className="absolute left-0 right-0 h-[2px] bg-white/5 z-0" />
            
            {/* Active filled line */}
            <div 
              className="absolute left-0 h-[2px] bg-gradient-to-r from-blue-500 to-emerald-400 z-0 transition-all duration-500" 
              style={{ width: `${(stageIdx / (STATUS_STAGES.length - 1)) * 100}%` }}
            />

            {STATUS_STAGES.map((stage, idx) => {
              const filled = idx <= stageIdx;
              const active = idx === stageIdx;
              
              return (
                <div key={stage} className="relative z-10">
                  <div
                    className={`w-3 h-3 rounded-full transition-all duration-300 flex items-center justify-center ${
                      filled
                        ? `bg-emerald-400 shadow-md ${style.glow}` 
                        : "bg-[#0d0d11] border border-white/10"
                    } ${active ? "ring-4 ring-emerald-400/20 scale-125" : ""}`}
                  >
                    {filled && (
                      <div className="w-1 h-1 bg-[#020204] rounded-full" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer / Performance Stats */}
      {card.status === "FINALIZED" && (
        <div className="flex items-center justify-between text-[10px] border-t border-white/5 pt-3 mt-1">
          <div className="flex items-center gap-3 text-gray-500 font-mono">
            <span>Slot: {card.finalizedSlot ?? "unknown"}</span>
            <span>•</span>
            <span>Latency: <span className="text-gray-300 font-semibold">{card.latencyMs ?? 0}ms</span></span>
            <span>•</span>
            <span>Attempts: <span className="text-gray-300 font-semibold">{card.attempts}</span></span>
          </div>
          {card.agentInvoked && (
            <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[9px] uppercase tracking-widest font-mono px-2 py-0.5 rounded-full">
              🤖 AI RECOVERED
            </span>
          )}
        </div>
      )}
    </div>
  );
}
