import PaymentQueue from "@/components/PaymentQueue";
import AgentPanel from "@/components/AgentPanel";
import SlotMonitor from "@/components/SlotMonitor";
import NotificationFeed from "@/components/NotificationFeed";

export default function DashboardPage() {
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

        <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
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
