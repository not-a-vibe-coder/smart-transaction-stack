// Phase 12 — Dynamic tip calculator (non-AI baseline).
// No hardcoded tip values — all derived from live TipStats.
import { NetworkHealth } from "../../types";
import type { TipFetcher } from "./tip-fetcher";
import type { NetworkHealthMonitor } from "../stream/network-health";

export class TipCalculator {
  private readonly tipFetcher: TipFetcher;
  private readonly healthMonitor: NetworkHealthMonitor;

  constructor(tipFetcher: TipFetcher, healthMonitor: NetworkHealthMonitor) {
    this.tipFetcher = tipFetcher;
    this.healthMonitor = healthMonitor;
    console.log("[tip-calc] 🧮 TipCalculator initialized");
  }

  calculateTip(paymentAmountLamports: number, attempt: number): number {
    if (this.tipFetcher.isStale()) {
      this.tipFetcher.refresh().catch(() => undefined);
    }

    const stats = this.tipFetcher.getStats();
    const health = this.healthMonitor.getStatus();

    // Base tip from network health
    let base: number;
    switch (health) {
      case NetworkHealth.HEALTHY:
        base = stats.medianLamports;
        break;
      case NetworkHealth.CONGESTED:
        base = stats.p75Lamports;
        break;
      case NetworkHealth.DEGRADED:
        base = stats.p95Lamports;
        break;
      default:
        base = stats.medianLamports;
    }

    // Retry multiplier
    const retryMultiplier =
      attempt === 1 ? 1.0 : attempt === 2 ? 1.25 : 1.5;

    // Payment size adjustment
    let sizeMultiplier = 1.0;
    if (paymentAmountLamports > 1_000_000_000) {
      sizeMultiplier = 1.2;
    } else if (paymentAmountLamports > 100_000_000) {
      sizeMultiplier = 1.1;
    }

    let tip = base * retryMultiplier * sizeMultiplier;

    // Floor and ceiling
    tip = Math.max(tip, stats.minLamports);
    tip = Math.min(tip, stats.p95Lamports * 2);

    const result = Math.floor(tip);

    console.log(
      `[tip-calc] 💰 Calculated tip: ${result} lamports (network: ${health}, attempt: ${attempt})`
    );

    return result;
  }

  explainTip(paymentAmountLamports: number, attempt: number): string {
    const stats = this.tipFetcher.getStats();
    const health = this.healthMonitor.getStatus();

    let baseLabel: string;
    let baseValue: number;
    switch (health) {
      case NetworkHealth.HEALTHY:
        baseLabel = "median";
        baseValue = stats.medianLamports;
        break;
      case NetworkHealth.CONGESTED:
        baseLabel = "p75";
        baseValue = stats.p75Lamports;
        break;
      default:
        baseLabel = "p95";
        baseValue = stats.p95Lamports;
    }

    const retryMult =
      attempt === 1 ? 1.0 : attempt === 2 ? 1.25 : 1.5;
    const sizeMult =
      paymentAmountLamports > 1_000_000_000
        ? 1.2
        : paymentAmountLamports > 100_000_000
        ? 1.1
        : 1.0;

    const final = this.calculateTip(paymentAmountLamports, attempt);

    return (
      `Network is ${health}. Using ${baseLabel} tip of ${baseValue} lamports` +
      ` × ${retryMult} retry multiplier` +
      (sizeMult !== 1.0 ? ` × ${sizeMult} size multiplier` : "") +
      ` = ${final} lamports`
    );
  }
}
