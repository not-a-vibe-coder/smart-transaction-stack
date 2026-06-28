"use client";
import { useState, useEffect } from "react";
import PaymentQueue from "@/components/PaymentQueue";
import AgentPanel from "@/components/AgentPanel";
import SlotMonitor from "@/components/SlotMonitor";
import NotificationFeed from "@/components/NotificationFeed";
import { onEvent } from "@/lib/ws-client";

type BatchStatus = "idle" | "dispatching" | "success" | "error";

interface BatchResult {
  total: number;
  queued: number;
  faultCount: number;
  paymentIds: string[];
  errors?: string[];
}

export default function DashboardPage() {
  const [recipient, setRecipient] = useState(
    "53owyhFdxjkvJRZL9weMgLfYGhjoRgDLrLhB63Khiooa"
  );
  const [baseAmount, setBaseAmount] = useState("10");
  const [memo, setMemo] = useState("Batch Demo");
  const [batchStatus, setBatchStatus] = useState<BatchStatus>("idle");
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Live batch tracking from websocket
  const [batchStarted, setBatchStarted] = useState<{
    total: number;
    faultCount: number;
  } | null>(null);

  useEffect(() => {
    const unsub = onEvent<Record<string, unknown>>("batch:started", (p) => {
      setBatchStarted({
        total: Number(p.total ?? 12),
        faultCount: Number(p.faultCount ?? 2),
      });
    });
    return () => unsub();
  }, []);

  const handleBatchDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchStatus("dispatching");
    setBatchResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch("http://localhost:3001/dispatch-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          baseAmount: parseFloat(baseAmount),
          memo,
        }),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        setBatchStatus("error");
        setErrorMsg(
          "The backend server needs to be restarted with the latest code. Run: npm run dev (in solana-pay-dispatcher/)"
        );
        return;
      }
      const data = (await res.json()) as BatchResult & { error?: string };
      if (res.ok && data.queued > 0) {
        setBatchStatus("success");
        setBatchResult(data);
      } else {
        setBatchStatus("error");
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
      }
    } catch (err) {
      setBatchStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Could not reach the backend. Is the server running?"
      );
    }
  };

  return (
    <div className="space-y-8 relative">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 border-b border-white/5 pb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] uppercase font-mono tracking-widest bg-blue-500/10 border border-blue-500/20 text-blue-400 px-3 py-1 rounded-full">
              MEV-Gated Stack
            </span>
            <span className="text-[11px] uppercase font-mono tracking-widest bg-purple-500/10 border border-purple-500/20 text-purple-400 px-3 py-1 rounded-full">
              🤖 AI Guardian Active
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white glow-text-blue">
            Smart Transaction Console
          </h1>
          <p className="text-sm text-gray-400 mt-2 max-w-lg leading-relaxed">
            Send a batch of payments using Jito bundles on Solana. The AI agent
            automatically detects and recovers failed transactions — no manual
            intervention needed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm font-mono shrink-0">
          <div className="glass-card px-4 py-2 border border-white/5 bg-white/[0.01]">
            <span className="text-gray-500">PROVIDER:</span>{" "}
            <span className="text-gray-200 font-semibold">HELIUS RPC</span>
          </div>
          <div className="glass-card px-4 py-2 border border-white/5 bg-white/[0.01]">
            <span className="text-gray-500">ENGINE:</span>{" "}
            <span className="text-emerald-400 font-semibold">JITO BUNDLES</span>
          </div>
        </div>
      </div>

      {/* ── Batch Dispatch Hero Panel ── */}
      <div className="glass-card p-6 border border-blue-500/20 bg-gradient-to-br from-blue-500/[0.04] to-purple-500/[0.03] relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

        {batchStatus !== "success" ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">
                  🚀 Dispatch 12 Payments
                </h2>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Sends{" "}
                  <span className="text-white font-semibold">
                    12 payments at once
                  </span>
                  . Two of them will intentionally fail so the AI can
                  demonstrate automatic recovery. Watch the queue below update
                  in real-time.
                </p>
              </div>
              <button
                onClick={() => setShowForm(!showForm)}
                className="shrink-0 text-xs font-mono text-gray-400 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-all"
              >
                {showForm ? "▲ Hide Options" : "▼ Show Options"}
              </button>
            </div>

            {/* Info chips */}
            <div className="flex flex-wrap gap-3 mb-6">
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <span className="text-lg">✅</span>
                <div>
                  <div className="text-emerald-400 font-bold text-base">
                    10 Normal
                  </div>
                  <div className="text-emerald-500/80 text-xs">
                    Sent successfully
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                <span className="text-lg">⚠️</span>
                <div>
                  <div className="text-rose-400 font-bold text-base">
                    2 Will Fail
                  </div>
                  <div className="text-rose-500/80 text-xs">
                    Expired blockhash injected
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
                <span className="text-lg">🤖</span>
                <div>
                  <div className="text-purple-400 font-bold text-base">
                    AI Recovers
                  </div>
                  <div className="text-purple-500/80 text-xs">
                    Auto-retry with fresh blockhash
                  </div>
                </div>
              </div>
            </div>

            {/* Optional form */}
            {showForm && (
              <form
                onSubmit={handleBatchDispatch}
                className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5 p-4 rounded-xl bg-black/20 border border-white/5"
              >
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs uppercase tracking-widest text-gray-500 font-mono">
                    Recipient Wallet
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full bg-[#040407] border border-white/10 rounded-lg p-2.5 text-sm font-mono text-gray-300 focus:outline-none focus:border-blue-500 transition-colors"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-widest text-gray-500 font-mono">
                    Base Amount (USDC)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={baseAmount}
                    onChange={(e) => setBaseAmount(e.target.value)}
                    className="w-full bg-[#040407] border border-white/10 rounded-lg p-2.5 text-sm font-mono text-gray-300 focus:outline-none focus:border-blue-500 transition-colors"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-widest text-gray-500 font-mono">
                    Memo Label
                  </label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="w-full bg-[#040407] border border-white/10 rounded-lg p-2.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div className="md:col-span-3 flex gap-3">
                  <button
                    type="submit"
                    disabled={batchStatus === "dispatching"}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold text-sm tracking-wide uppercase py-3 rounded-xl hover:from-blue-500 hover:to-blue-400 transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                  >
                    {batchStatus === "dispatching"
                      ? "⏳ Dispatching Batch..."
                      : "🚀 Dispatch 12 Payments Now"}
                  </button>
                </div>
              </form>
            )}

            {/* Big dispatch button when form is hidden */}
            {!showForm && (
              <button
                onClick={handleBatchDispatch}
                disabled={batchStatus === "dispatching"}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold text-lg tracking-wide py-4 rounded-xl hover:from-blue-500 hover:to-purple-500 transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 active:scale-[0.98] flex items-center justify-center gap-3"
              >
                {batchStatus === "dispatching" ? (
                  <>
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Dispatching Payments…
                  </>
                ) : (
                  <>⚡ Dispatch 12 Payments Now</>
                )}
              </button>
            )}

            {/* Error message */}
            {batchStatus === "error" && errorMsg && (
              <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                <p className="text-rose-400 font-semibold text-sm mb-1">
                  ❌ Dispatch Failed
                </p>
                <p className="text-rose-300/80 text-sm">{errorMsg}</p>
              </div>
            )}
          </>
        ) : (
          /* Success state */
          <div className="text-center py-4">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Batch Dispatched!
            </h2>
            <p className="text-gray-400 text-base mb-6 leading-relaxed">
              <span className="text-emerald-400 font-bold">
                {batchResult?.queued} payments
              </span>{" "}
              are now in the queue.{" "}
              <span className="text-rose-400 font-bold">
                {batchResult?.faultCount} will fail intentionally
              </span>{" "}
              — the AI agent will detect each failure, reason through it, refresh
              the blockhash, and retry automatically. Watch the panels below.
            </p>
            <div className="flex justify-center gap-4 flex-wrap mb-6">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-5 py-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">
                  {(batchResult?.queued ?? 0) - (batchResult?.faultCount ?? 0)}
                </div>
                <div className="text-xs text-emerald-500/80 uppercase tracking-wider mt-1">
                  Normal Payments
                </div>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-5 py-3 text-center">
                <div className="text-2xl font-bold text-rose-400">
                  {batchResult?.faultCount ?? 0}
                </div>
                <div className="text-xs text-rose-500/80 uppercase tracking-wider mt-1">
                  Failing (AI Will Fix)
                </div>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl px-5 py-3 text-center">
                <div className="text-2xl font-bold text-purple-400">AUTO</div>
                <div className="text-xs text-purple-500/80 uppercase tracking-wider mt-1">
                  AI Recovery Mode
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setBatchStatus("idle");
                setBatchResult(null);
              }}
              className="text-sm text-gray-400 hover:text-white border border-white/10 hover:border-white/20 px-4 py-2 rounded-lg transition-all"
            >
              Send Another Batch
            </button>
          </div>
        )}
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1 glass-card p-5 border border-white/5">
          <PaymentQueue />
        </div>
        <div className="lg:col-span-1 glass-card p-5 border border-white/5">
          <AgentPanel />
        </div>
        <div className="lg:col-span-1 glass-card p-5 border border-white/5">
          <SlotMonitor />
        </div>
      </div>

      <NotificationFeed />
    </div>
  );
}
