// Phase 8 — Leader schedule fetcher + Jito validator detector.
import { EventEmitter } from "eventemitter3";
import type { LeaderWindow } from "../../types";
import type { SolanaRpcClient } from "../rpc/client";
import type { SlotSubscriber } from "./slot-subscriber";
import type { SlotUpdate } from "../../types";
import { sleep } from "../rpc/client";

// Fetch dynamically from Jito block engine in production
const KNOWN_JITO_VALIDATORS = new Set<string>([
  "J1to1yVEQuPkpCm3Y8vMkQq5k8kcuPFPxTGHNVxiqfHp",
  "J1to2NAwSBfLqBSMqnJBCNpEFSRi1pWkBUyJsKBGAGMf",
  "J1toVAFVLMFekFkRyB9n4GmHGZEjFMVWqG3tBSCALqms",
  "J1toa1BT2fmQxAbFqW2LoTtaG9R7gXgEerQGEiMiMAWo",
  "J1toDbuBovAXnmoZTL5fTqGpBeFHRxNLb3kpNGCHdFMU",
  "CW9C7HBwAMgqNdXkNgFg9Ujr3edR2Ab9ymEuQnVacd1A",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWgRGmk",
  "GZctHpWXmsZC9YLH85w7om8B8sLGKlSmjXFtGkBmHFYS",
]);

interface LeaderDetectorEvents {
  jitoLeader: (window: LeaderWindow) => void;
  error: (error: Error) => void;
}

export class LeaderDetector extends EventEmitter<LeaderDetectorEvents> {
  private readonly rpcClient: SolanaRpcClient;
  private readonly slotSubscriber: SlotSubscriber;
  private leaderSchedule = new Map<number, string>();
  private currentEpoch = -1;
  private emittedSlots = new Set<number>();
  private lastJitoWindow: LeaderWindow | null = null;
  private slotListener: ((update: SlotUpdate) => void) | null = null;

  constructor(rpcClient: SolanaRpcClient, slotSubscriber: SlotSubscriber) {
    super();
    this.rpcClient = rpcClient;
    this.slotSubscriber = slotSubscriber;
    console.log("[leader] 🗓️ LeaderDetector initialized");
  }

  async start(): Promise<void> {
    await this.fetchLeaderSchedule().catch((err: Error) => this.emit("error", err));

    this.slotListener = (update: SlotUpdate) => {
      if (update.commitment === "confirmed") {
        this.checkUpcomingLeader(update.slot);
      }
    };

    this.slotSubscriber.on("slot", this.slotListener);
    console.log("[leader] ▶️ Leader detection started");
  }

  async stop(): Promise<void> {
    if (this.slotListener) {
      this.slotSubscriber.off("slot", this.slotListener);
      this.slotListener = null;
    }
    console.log("[leader] ⏹️ Leader detection stopped");
  }

  private async fetchLeaderSchedule(): Promise<void> {
    try {
      const connection = this.rpcClient.getConnection();
      const epochInfo = await connection.getEpochInfo();

      if (epochInfo.epoch === this.currentEpoch) {
        return;
      }

      const scheduleRaw = await connection.getLeaderSchedule();

      if (!scheduleRaw) {
        console.warn("[leader] ⚠️ Leader schedule returned null, retrying in 2s...");
        await sleep(2000);
        return this.fetchLeaderSchedule();
      }

      // getLeaderSchedule returns slot offsets relative to epoch start.
      // Add epochStart to each offset to get real absolute slot numbers.
      const epochStart = epochInfo.absoluteSlot - epochInfo.slotIndex;
      this.leaderSchedule.clear();
      this.emittedSlots.clear();

      for (const [pubkey, slotOffsets] of Object.entries(scheduleRaw)) {
        for (const offset of slotOffsets) {
          const absoluteSlot = epochStart + offset;
          this.leaderSchedule.set(absoluteSlot, pubkey);
        }
      }

      this.currentEpoch = epochInfo.epoch;

      const jitoCount = [...this.leaderSchedule.values()].filter((pk) =>
        KNOWN_JITO_VALIDATORS.has(pk)
      ).length;

      console.log(
        `[leader] 📅 Leader schedule fetched — epoch ${epochInfo.epoch}, ${this.leaderSchedule.size} slots mapped`
      );
      console.log(
        `[leader] ⚡ ${jitoCount} Jito validators found in epoch schedule`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch leader schedule: ${msg}`);
    }
  }

  private checkUpcomingLeader(currentSlot: number): void {
    for (let ahead = 1; ahead <= 4; ahead++) {
      const upcomingSlot = currentSlot + ahead;
      const pubkey = this.leaderSchedule.get(upcomingSlot);

      if (
        !pubkey ||
        !KNOWN_JITO_VALIDATORS.has(pubkey) ||
        this.emittedSlots.has(upcomingSlot)
      ) {
        continue;
      }

      const window: LeaderWindow = {
        validatorPubkey: pubkey,
        isJitoValidator: true,
        slotStart: upcomingSlot,
        slotEnd: upcomingSlot + 3,
        slotsUntilLeader: ahead,
      };

      this.emittedSlots.add(upcomingSlot);
      this.lastJitoWindow = window;
      this.emit("jitoLeader", window);
      console.log(
        `[leader] ⚡ Jito leader in ${ahead} slots — ${pubkey.slice(0, 8)}...`
      );
      break;
    }

    // Refresh near epoch boundary
    if (currentSlot % 432000 > 431800) {
      this.fetchLeaderSchedule().catch((err: Error) => this.emit("error", err));
    }
  }

  getNextJitoWindow(): LeaderWindow | null {
    if (process.env.SOLANA_NETWORK !== "mainnet-beta") {
      const latestSlot = this.slotSubscriber.getLatestSlot()?.slot ?? 0;
      return {
        validatorPubkey: "J1to1yVEQuPkpCm3Y8vMkQq5k8kcuPFPxTGHNVxiqfHp",
        isJitoValidator: true,
        slotStart: latestSlot + 1,
        slotEnd: latestSlot + 4,
        slotsUntilLeader: 1,
      };
    }
    return this.lastJitoWindow;
  }
}
