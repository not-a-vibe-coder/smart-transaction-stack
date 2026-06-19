"use client";
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
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

const HEALTH_STYLE: Record<NetworkHealth, { pill: string; label: string }> = {
  HEALTHY: { pill: "bg-green-800 text-green-200", label: "● HEALTHY" },
  CONGESTED: { pill: "bg-yellow-800 text-yellow-200", label: "● CONGESTED" },
  DEGRADED: { pill: "bg-red-800 text-red-200", label: "● DEGRADED" },
};

function slotRateColor(rate: number): string {
  if (rate >= 2.0) return "text-green-400";
  if (rate >= 1.5) return "text-yellow-400";
  return "text-red-400";
}

function latencyColor(ms: number): string {
  if (ms < 800) return "text-green-400";
  if (ms < 2000) return "text-yellow-400";
  return "text-red-400";
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
        setHealth((payload.status as NetworkHealth) ?? "HEALTHY");
        setSlotRate(Number(payload.slotRate ?? 0));
        setP2cMs(Number(payload.processedToConfirmedDeltaMs ?? 0));
        setCurrentSlot(Number(payload.currentSlot ?? 0));

        if (payload.processedToConfirmedDeltaMs !== undefined) {
          const point: LatencyPoint = {
            slot: Number(payload.currentSlot ?? 0),
            processedToConfirmed: Number(payload.processedToConfirmedDeltaMs),
            time: Date.now(),
          };
          setLatencyHistory((prev) => [...prev, point].slice(-30));
        }
      }
    );

    const unsubLeader = onEvent<LeaderWindow>("slot:update", (payload) => {
      // Leader window updates arrive embedded in slot updates in some configs
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
    <div>
      <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider mb-4">
        Network Monitor
      </h2>

      {/* Health banner */}
      <div className={`inline-flex px-3 py-1 rounded-full text-sm font-medium mb-4 ${healthStyle.pill}`}>
        {healthStyle.label}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatBox
          label="Current Slot"
          value={currentSlot.toLocaleString()}
          valueClass="font-mono text-white"
        />
        <StatBox
          label="Slot Rate"
          value={`${slotRate.toFixed(1)} / sec`}
          valueClass={slotRateColor(slotRate)}
        />
        <StatBox
          label="Processed→Conf"
          value={`${p2cMs}ms`}
          valueClass={latencyColor(p2cMs)}
        />
        <StatBox
          label="Next Jito In"
          value={jitoLeader ? `${jitoLeader.slotsUntilLeader} slots` : "Waiting..."}
          valueClass="text-green-400"
        />
      </div>

      {/* Latency sparkline */}
      {latencyHistory.length > 1 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-1.5">
            Processed → Confirmed Latency (last 30 slots)
          </p>
          <div className="bg-gray-950 rounded p-2">
            <ResponsiveContainer width="100%" height={60}>
              <LineChart data={latencyHistory}>
                <Line
                  type="monotone"
                  dataKey="processedToConfirmed"
                  stroke="#22c55e"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#111",
                    border: "1px solid #333",
                    borderRadius: 4,
                    fontSize: 11,
                    color: "#ccc",
                  }}
                  formatter={(value) => [`${Number(value ?? 0)}ms`, "p→c"]}
                  labelFormatter={(_, payload) =>
                    payload?.[0] ? `Slot ${(payload[0].payload as LatencyPoint).slot}` : ""
                  }
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Jito leader info */}
      {jitoLeader && (
        <div className="bg-gray-900 border border-gray-800 rounded p-3 text-xs">
          <p className="text-yellow-400 font-medium mb-1">⚡ Next Jito validator:</p>
          <p className="text-gray-300 font-mono mb-1">
            {jitoLeader.validatorPubkey.slice(0, 12)}...
          </p>
          <p className="text-gray-500">
            Slot window: {jitoLeader.slotStart} → {jitoLeader.slotEnd}
          </p>
          <div className="mt-2 bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-yellow-500 h-1.5 rounded-full transition-all"
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
    <div className="bg-gray-900 border border-gray-800 rounded p-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-base font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
