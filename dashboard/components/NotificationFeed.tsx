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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`max-w-sm p-3 rounded-lg border text-sm shadow-lg transition-all ${
            n.succeeded
              ? "bg-green-950 border-green-700 text-green-200"
              : "bg-red-950 border-red-700 text-red-200"
          }`}
        >
          <div className="font-medium">
            🤖 AI {n.succeeded ? "recovered" : "failed"} payment
          </div>
          <div className="text-xs mt-1 opacity-80">
            [attempt {n.attempt}] {n.diagnosis.slice(0, 60)}...
          </div>
        </div>
      ))}
    </div>
  );
}
