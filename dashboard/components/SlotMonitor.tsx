"use client";
import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { onEvent } from "@/lib/ws-client";
import type { NetworkHealth, LeaderWindow } from "@/lib/types";

interface LatencyPoint {
  slot: number;
  processedToConfirmed: number;
  time: number;
}

const HEALTH_STYLE: Record<NetworkHealth, { pill: string; label: string; border: string; glow: string }> = {
  HEALTHY: { pill: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", label: "● HEALTHY", border: "border-emerald-500/20", glow: "shadow-emerald-500/10" },
  CONGESTED: { pill: "bg-amber-500/10 border-amber-500/30 text-amber-400", label: "● CONGESTED", border: "border-amber-500/20", glow: "shadow-amber-500/10" },
  DEGRADED: { pill: "bg-rose-500/10 border-rose-500/30 text-rose-400", label: "● DEGRADED", border: "border-rose-500/20", glow: "shadow-rose-500/10" },
};

function slotRateColor(rate: number): string {
  if (rate >= 2.0) return "text-emerald-400";
  if (rate >= 1.5) return "text-amber-400";
  return "text-rose-400";
}

function latencyColor(ms: number): string {
  if (ms < 500) return "text-emerald-400 glow-text-green";
  if (ms < 1500) return "text-amber-400 glow-text-orange";
  return "text-rose-400";
}

export default function SlotMonitor() {
  const [currentSlot, setCurrentSlot] = useState(0);
  const [health, setHealth] = useState<NetworkHealth>("HEALTHY");
  const [slotRate, setSlotRate] = useState(0);
  const [p2cMs, setP2cMs] = useState(0);
  const [jitoLeader, setJitoLeader] = useState<LeaderWindow | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<LatencyPoint[]>([]);

  useEffect(() => {
    const unsubSlot = onEvent<Record<string, unknown>>("slot:update", (payload) => {
      const slot = Number(payload.slot ?? 0);
      setCurrentSlot(slot);
    });

    const unsubHealth = onEvent<Record<string, unknown>>(
      "network:health",
      (payload) => {
        const h = (payload.status as NetworkHealth) ?? "HEALTHY";
        setHealth(h);
        setSlotRate(Number(payload.slotRate ?? 0));
        
        const lat = Number(payload.processedToConfirmedDeltaMs ?? 0);
        setP2cMs(lat);
        setCurrentSlot(Number(payload.currentSlot ?? 0));

        if (payload.currentSlot !== undefined && lat > 0) {
          const point: LatencyPoint = {
            slot: Number(payload.currentSlot),
            processedToConfirmed: lat,
            time: Date.now(),
          };
          setLatencyHistory((prev) => {
            const next = [...prev, point].slice(-30);
            return next;
          });
        }
      }
    );

    const unsubLeader = onEvent<LeaderWindow>("slot:update", (payload) => {
      if ((payload as unknown as Record<string, unknown>).isJitoValidator) {
        setJitoLeader(payload as unknown as LeaderWindow);
      }
    });

    return () => {
      unsubSlot();
      unsubHealth();
      unsubLeader();
    };
  }, []);

  const healthStyle = HEALTH_STYLE[health] ?? HEALTH_STYLE.HEALTHY;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Telemetry Monitor
        </h2>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${healthStyle.pill} ${healthStyle.glow}`}>
          {healthStyle.label}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatBox
          label="Current Slot"
          value={currentSlot > 0 ? currentSlot.toLocaleString() : "Syncing..."}
          valueClass="font-mono text-white tracking-tight"
        />
        <StatBox
          label="Slot Progress Rate"
          value={slotRate > 0 ? `${slotRate.toFixed(2)} sl/s` : "Syncing..."}
          valueClass={slotRateColor(slotRate)}
        />
        <StatBox
          label="Processed → Confirmed"
          value={p2cMs > 0 ? `${p2cMs}ms` : "Syncing..."}
          valueClass={latencyColor(p2cMs)}
        />
        <StatBox
          label="Next Jito In"
          value={jitoLeader ? `${jitoLeader.slotsUntilLeader} slots` : "Gated Window"}
          valueClass="text-blue-400 font-mono"
        />
      </div>

      {/* Latency Area Chart */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-mono">
            Slot Confirmation Delay (ms)
          </p>
          {latencyHistory.length > 0 && (
            <span className="text-[9px] text-emerald-400 font-mono">
              Live updates active
            </span>
          )}
        </div>
        
        <div className="h-[90px] w-full bg-[#040407] rounded-lg border border-white/5 p-2 overflow-hidden">
          {latencyHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyHistory}>
                <defs>
                  <linearGradient id="latencyGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="processedToConfirmed"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#latencyGlow)"
                  dot={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#09090b",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    fontSize: 10,
                    color: "#f3f4f6",
                    fontFamily: "monospace"
                  }}
                  formatter={(value) => [`${value}ms`, "Delay"]}
                  labelFormatter={(label, payload) => 
                    payload?.[0] ? `Slot ${(payload[0].payload as LatencyPoint).slot}` : ""
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-[10px] text-gray-600 font-mono">
              Waiting for slot validation telemetry...
            </div>
          )}
        </div>
      </div>

      {/* Jito leader details */}
      {jitoLeader && (
        <div className="glass-card p-4 space-y-2 border border-blue-500/10">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400 font-medium">Jito Schedule Window</span>
            <span className="text-blue-400 font-mono uppercase tracking-widest text-[9px] bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
              active leader
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-gray-500 font-mono flex items-center justify-between">
              <span>Validator:</span>
              <span className="text-gray-300 font-bold">{jitoLeader.validatorPubkey.slice(0, 16)}...</span>
            </p>
            <p className="text-[10px] text-gray-500 font-mono flex items-center justify-between">
              <span>Gated Slots:</span>
              <span className="text-gray-300">{jitoLeader.slotStart} → {jitoLeader.slotEnd}</span>
            </p>
          </div>
          <div className="mt-2 bg-white/5 rounded-full h-1.5 overflow-hidden border border-white/5">
            <div
              className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full transition-all duration-300"
              style={{
                width: `${Math.max(0, 100 - jitoLeader.slotsUntilLeader * 25)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="glass-card p-3 border border-white/5 hover:border-white/10 transition-colors">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-mono mb-1">{label}</p>
      <p className={`text-sm font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
