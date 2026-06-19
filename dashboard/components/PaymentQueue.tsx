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

const STATUS_COLOR: Record<PaymentStatus, string> = {
  QUEUED: "bg-gray-600 text-gray-100",
  SUBMITTED: "bg-blue-600 text-white",
  PROCESSED: "bg-yellow-500 text-black",
  CONFIRMED: "bg-orange-500 text-white",
  FINALIZED: "bg-green-600 text-white",
  FAILED: "bg-red-600 text-white",
  ABANDONED: "bg-red-900 text-red-200",
};

const DOT_COLOR: Record<PaymentStatus, string> = {
  QUEUED: "bg-gray-500",
  SUBMITTED: "bg-blue-500",
  PROCESSED: "bg-yellow-400",
  CONFIRMED: "bg-orange-400",
  FINALIZED: "bg-green-500",
  FAILED: "bg-red-500",
  ABANDONED: "bg-red-900",
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
            payload.amountLamports
              ? Number(payload.amountLamports) / 1e6
              : payload.amountUsdc as number ?? existing.amountUsdc,
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
    <div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          Payment Queue
        </h2>
        <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
          {payments.size}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-gray-600 text-sm">No payments yet — dispatch one via POST /dispatch</p>
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
          className="block mt-3 text-xs text-blue-400 hover:text-blue-300"
        >
          View all {payments.size} payments →
        </Link>
      )}
    </div>
  );
}

function PaymentCard({ card }: { card: PaymentCardData }) {
  const stageIdx = STATUS_STAGES.indexOf(card.status);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      {/* Top row */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-green-400 font-semibold text-sm">
          {card.amountUsdc.toFixed(2)} USDC
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[card.status] ?? "bg-gray-700 text-white"}`}
        >
          {card.status}
        </span>
      </div>

      {/* Middle row */}
      <div className="text-xs text-gray-400 mb-3">
        <span>To: {card.recipientPubkey.slice(0, 8)}...</span>
        {card.memo && (
          <span className="ml-2 italic text-gray-500">{card.memo}</span>
        )}
      </div>

      {/* Timeline dots */}
      <div className="flex items-center gap-1 mb-2">
        {STATUS_STAGES.map((stage, idx) => {
          const filled = idx <= stageIdx;
          return (
            <div key={stage} className="flex items-center gap-1">
              <div
                className={`w-2.5 h-2.5 rounded-full border ${
                  filled
                    ? `${DOT_COLOR[card.status] ?? "bg-green-500"} border-transparent`
                    : "border-gray-700 bg-transparent"
                }`}
              />
              {idx < STATUS_STAGES.length - 1 && (
                <div
                  className={`h-px w-4 ${filled && idx < stageIdx ? "bg-gray-500" : "bg-gray-800"}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {card.status === "FINALIZED" && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>⚡ {card.latencyMs ?? 0}ms · {card.attempts} attempt(s)</span>
          {card.agentInvoked && (
            <span className="bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded">
              🤖 AI recovered
            </span>
          )}
        </div>
      )}
    </div>
  );
}
