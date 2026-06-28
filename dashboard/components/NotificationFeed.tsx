"use client";
import { useEffect, useState } from "react";
import { onEvent } from "@/lib/ws-client";

type NotifType = "retry_success" | "retry_failed" | "abandoned" | "batch_started";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  timestamp: number;
}

export default function NotificationFeed() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotif = (notif: Notification, ttlMs = 7000) => {
    setNotifications((prev) => [notif, ...prev].slice(0, 4));
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    }, ttlMs);
  };

  useEffect(() => {
    // Retry notifications
    const unsubRetry = onEvent<Record<string, unknown>>(
      "notification:retry",
      (payload) => {
        const succeeded = Boolean(payload.succeeded);
        const paymentShort = String(payload.paymentId ?? "").slice(0, 8);
        const attempt = Number(payload.attempt ?? 1);
        const diagnosis = String(payload.diagnosis ?? "");

        addNotif({
          id: Math.random().toString(36).slice(2),
          type: succeeded ? "retry_success" : "retry_failed",
          title: succeeded
            ? "✅ Payment Recovered!"
            : "⚠️ Retry Attempt In Progress",
          message: succeeded
            ? `The AI fixed payment ${paymentShort}… after ${attempt} attempt${attempt !== 1 ? "s" : ""}. It's now complete.`
            : `Payment ${paymentShort}… failed (${diagnosis.slice(0, 60)}). AI is retrying…`,
          timestamp: Number(payload.timestamp ?? Date.now()),
        });
      }
    );

    // Payment abandoned — user must be notified
    const unsubUpdate = onEvent<Record<string, unknown>>(
      "payment:update",
      (payload) => {
        if (payload.status !== "ABANDONED") return;
        const paymentShort = String(payload.paymentId ?? "").slice(0, 8);
        addNotif(
          {
            id: Math.random().toString(36).slice(2),
            type: "abandoned",
            title: "🚨 Payment Could Not Be Completed",
            message: `Payment ${paymentShort}… could not be sent after several attempts. Please check the recipient address or try again later.`,
            timestamp: Date.now(),
          },
          12000 // keep abandoned alerts longer
        );
      }
    );

    // Batch started
    const unsubBatch = onEvent<Record<string, unknown>>(
      "batch:started",
      (payload) => {
        const total = Number(payload.total ?? 12);
        const faultCount = Number(payload.faultCount ?? 2);
        addNotif({
          id: Math.random().toString(36).slice(2),
          type: "batch_started",
          title: "🚀 Batch Dispatched",
          message: `${total} payments are now in the queue. ${faultCount} will fail intentionally — watch the AI recover them automatically.`,
          timestamp: Date.now(),
        });
      }
    );

    return () => {
      unsubRetry();
      unsubUpdate();
      unsubBatch();
    };
  }, []);

  if (notifications.length === 0) return null;

  const STYLES: Record<NotifType, string> = {
    retry_success:
      "bg-emerald-950/90 border-emerald-500/35 shadow-emerald-500/15",
    retry_failed: "bg-amber-950/90 border-amber-500/35 shadow-amber-500/10",
    abandoned: "bg-red-950/90 border-red-500/40 shadow-red-500/20",
    batch_started: "bg-blue-950/90 border-blue-500/35 shadow-blue-500/15",
  };

  const TITLE_STYLES: Record<NotifType, string> = {
    retry_success: "text-emerald-300",
    retry_failed: "text-amber-300",
    abandoned: "text-red-300",
    batch_started: "text-blue-300",
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-3 max-w-sm w-full px-4 sm:px-0">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`p-4 rounded-2xl border shadow-2xl backdrop-blur-md transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in ${STYLES[n.type]}`}
        >
          <div
            className={`font-bold text-sm mb-1 flex items-center gap-2 ${TITLE_STYLES[n.type]}`}
          >
            {n.title}
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          </div>
          <p className="text-gray-200 text-sm leading-relaxed">{n.message}</p>
          <p className="text-gray-500 text-xs mt-2 font-mono">
            {new Date(n.timestamp).toLocaleTimeString()}
          </p>
        </div>
      ))}
    </div>
  );
}
