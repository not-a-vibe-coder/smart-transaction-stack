"use client";
import { useEffect, useState } from "react";
import { onEvent } from "@/lib/ws-client";

interface Notification {
  id: string;
  paymentId: string;
  attempt: number;
  diagnosis: string;
  succeeded: boolean;
  timestamp: number;
}

export default function NotificationFeed() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const unsub = onEvent<Record<string, unknown>>(
      "notification:retry",
      (payload) => {
        const notif: Notification = {
          id: Math.random().toString(36).slice(2),
          paymentId: String(payload.paymentId ?? ""),
          attempt: Number(payload.attempt ?? 1),
          diagnosis: String(payload.diagnosis ?? ""),
          succeeded: Boolean(payload.succeeded),
          timestamp: Number(payload.timestamp ?? Date.now()),
        };

        setNotifications((prev) => [notif, ...prev].slice(0, 3));

        // Auto-dismiss after 6s
        setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
        }, 6000);
      }
    );

    return () => { unsub(); };
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full px-4 sm:px-0">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`p-4 rounded-xl border text-xs shadow-2xl backdrop-blur-md transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in ${
            n.succeeded
              ? "bg-emerald-950/80 border-emerald-500/30 text-emerald-200 shadow-emerald-500/10"
              : "bg-rose-950/80 border-rose-500/30 text-rose-200 shadow-rose-500/10"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold uppercase tracking-wider mb-1 font-mono">
            <span>🤖 AI Recovery Status</span>
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          </div>
          <p className="text-[11px] text-white font-medium">
            AI {n.succeeded ? "successfully re-routed and recovered" : "initiated failover on"} payment {n.paymentId.slice(0, 8)}...
          </p>
          <div className="text-[10px] font-mono mt-2 pt-2 border-t border-white/5 opacity-80 flex justify-between items-center">
            <span>Attempt #{n.attempt}</span>
            <span>{n.diagnosis.slice(0, 45)}...</span>
          </div>
        </div>
      ))}
    </div>
  );
}
