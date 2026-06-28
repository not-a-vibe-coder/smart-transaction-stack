"use client";
import { useState } from "react";
import PaymentQueue from "@/components/PaymentQueue";
import AgentPanel from "@/components/AgentPanel";
import SlotMonitor from "@/components/SlotMonitor";
import NotificationFeed from "@/components/NotificationFeed";

export default function DashboardPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [recipient, setRecipient] = useState("53owyhFdxjkvJRZL9weMgLfYGhjoRgDLrLhB63Khiooa");
  const [amount, setAmount] = useState("1000.00");
  const [memo, setMemo] = useState("AI Recovery Test Transaction");
  const [status, setStatus] = useState<string | null>(null);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("http://localhost:3001/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient,
          amount: parseFloat(amount),
          memo,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus("success");
        setTimeout(() => {
          setStatus(null);
          setIsOpen(false);
        }, 1500);
      } else {
        setStatus(`Error: ${data.error ?? "Failed"}`);
      }
    } catch (err) {
      setStatus(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-8 relative">
      {/* Top Welcome & Summary Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase font-mono tracking-widest bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
              MEV Gated Stack
            </span>
            <span className="text-[10px] uppercase font-mono tracking-widest bg-purple-500/10 border border-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
              AI Guardian Active
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white glow-text-blue">
            Transaction Stack Console
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Real-time telemetry, Jito bundle monitoring, and autonomous failure recovery logs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="glass-card px-4 py-2 border border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:border-blue-500/50 transition-all font-semibold rounded-lg flex items-center gap-2 shadow-lg shadow-blue-500/10 active:scale-95"
          >
            <span>⚡</span> Dispatch Transaction
          </button>

          <div className="hidden sm:flex items-center gap-4 text-gray-400">
            <div className="glass-card px-4 py-2 border border-white/5 bg-white/[0.01]">
              <span className="text-gray-500">PROVIDER:</span>{" "}
              <span className="text-gray-300 font-semibold">HELIUS RPC</span>
            </div>
            <div className="glass-card px-4 py-2 border border-white/5 bg-white/[0.01]">
              <span className="text-gray-500">ENGINE:</span>{" "}
              <span className="text-emerald-400 font-semibold">JITO BLOCK ENGINE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Slide-out/Form Panel */}
      {isOpen && (
        <div className="glass-card p-6 border border-blue-500/20 bg-blue-500/[0.01] animate-in slide-in-from-top duration-300 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-blue-400">
              New Transaction Request
            </h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
          <form onSubmit={handleDispatch} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">
                Recipient Wallet Address
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full bg-[#040407] border border-white/10 rounded-lg p-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-blue-500 transition-colors"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4 col-span-1 md:col-span-1">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">
                  Amount (USDC)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-[#040407] border border-white/10 rounded-lg p-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-blue-500 transition-colors"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest text-gray-500 font-mono">
                  Memo
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="w-full bg-[#040407] border border-white/10 rounded-lg p-2 text-xs text-gray-300 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={status === "submitting"}
                className="flex-1 bg-blue-500 text-white font-semibold text-xs tracking-wider uppercase p-2 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {status === "submitting" ? "Dispatching..." : "Submit Dispatch"}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-xs text-gray-300 px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </form>
          {status && status !== "submitting" && (
            <div className={`mt-3 text-xs font-mono ${status === "success" ? "text-emerald-400" : "text-rose-400"}`}>
              {status === "success" ? "✓ Transaction queued successfully!" : status}
            </div>
          )}
        </div>
      )}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Transaction list */}
        <div className="lg:col-span-1 glass-card p-5 border border-white/5">
          <PaymentQueue />
        </div>

        {/* Center Column: AI Agent Operations */}
        <div className="lg:col-span-1 glass-card p-5 border border-white/5">
          <AgentPanel />
        </div>

        {/* Right Column: Slot updates and Telemetry */}
        <div className="lg:col-span-1 glass-card p-5 border border-white/5">
          <SlotMonitor />
        </div>
      </div>

      <NotificationFeed />
    </div>
  );
}
