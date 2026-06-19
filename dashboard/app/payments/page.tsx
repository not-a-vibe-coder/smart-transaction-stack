"use client";
import { useEffect, useState } from "react";
import type { PaymentStatus } from "@/lib/types";

interface PaymentRow {
  id: string;
  recipientPubkey: string;
  amountLamports: number;
  status: PaymentStatus;
  createdAt: number;
  attempts?: number;
}

const STATUS_COLOR: Record<PaymentStatus, string> = {
  QUEUED: "bg-gray-600",
  SUBMITTED: "bg-blue-600",
  PROCESSED: "bg-yellow-600",
  CONFIRMED: "bg-orange-500",
  FINALIZED: "bg-green-600",
  FAILED: "bg-red-600",
  ABANDONED: "bg-red-900",
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:3001/payments")
      .then((r) => r.json())
      .then((data) => {
        setPayments(data as PaymentRow[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-gray-400 text-sm animate-pulse">Loading payments...</div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-6">Payment History</h1>
      {payments.length === 0 ? (
        <p className="text-gray-500 text-sm">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left py-3 px-4">ID</th>
                <th className="text-left py-3 px-4">Amount</th>
                <th className="text-left py-3 px-4">Recipient</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-left py-3 px-4">Time</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-800/50 hover:bg-gray-900 transition-colors"
                >
                  <td className="py-3 px-4 font-mono text-gray-300">
                    {p.id.slice(0, 8)}...
                  </td>
                  <td className="py-3 px-4 text-green-400 font-medium">
                    {(p.amountLamports / 1e6).toFixed(2)} USDC
                  </td>
                  <td className="py-3 px-4 font-mono text-gray-400">
                    {p.recipientPubkey.slice(0, 8)}...
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full text-white ${STATUS_COLOR[p.status] ?? "bg-gray-700"}`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {new Date(p.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
