// Phase 23 — Fault injection simulator.
// Controlled failures for generating required hackathon logs.
// INJECT_FAULT env controls this; when NONE it is completely transparent.
import type { BlockhashWithExpiryBlockHeight } from "@solana/web3.js";
import { FaultType } from "../types";
import type { PaymentRequest } from "../types";
import type { SolanaRpcClient } from "../core/rpc/client";

export class FaultInjector {
  private readonly faultType: FaultType;
  private hasInjected = false;

  constructor(faultType: FaultType) {
    this.faultType = faultType;

    if (faultType !== FaultType.NONE) {
      console.warn(`[fault] ⚠️  FAULT INJECTION ACTIVE: ${faultType}`);
      console.warn(
        "[fault] ⚠️  This will intentionally cause a failure to test AI recovery"
      );
    }
  }

  getFaultType(): FaultType {
    return this.faultType;
  }

  async injectExpiredBlockhash(
    rpcClient: SolanaRpcClient
  ): Promise<BlockhashWithExpiryBlockHeight> {
    const real = await rpcClient.getLatestBlockhash();
    console.log(
      "[fault] 💉 Injecting expired blockhash (lastValidBlockHeight set to 1)"
    );
    return { ...real, lastValidBlockHeight: 1 };
  }

  injectLowFee(realTipLamports: number): number {
    const injected = Math.floor(realTipLamports * 0.01);
    console.log(
      `[fault] 💉 Injecting low fee: ${injected} lamports (real was ${realTipLamports})`
    );
    return injected;
  }

  shouldInjectForPayment(payment: PaymentRequest): boolean {
    if (this.faultType === FaultType.NONE) return false;
    if (this.hasInjected) return false;
    // Only inject for the very first payment
    if (payment.injectFault && payment.injectFault !== FaultType.NONE) {
      this.hasInjected = true;
      return true;
    }
    return false;
  }

  simulateLeaderSkip(): boolean {
    console.log("[fault] 💉 Simulating leader skip");
    return true;
  }
}

export const createFaultInjector = (): FaultInjector => {
  const raw = (process.env.INJECT_FAULT ?? "none") as FaultType;
  const faultType: FaultType =
    Object.values(FaultType).includes(raw) ? raw : FaultType.NONE;
  return new FaultInjector(faultType);
};
