// Phase 25 — WebSocket + Express server for dashboard feed.
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { WsEvent, WsEventType } from "../types";
import type { PayDispatcher } from "../dispatcher";
import type { LifecycleStore } from "../core/db/store";

export class WsServer {
  private readonly dispatcher: PayDispatcher;
  private readonly store: LifecycleStore;
  private readonly port: number;
  private readonly app: express.Application;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  constructor(dispatcher: PayDispatcher, store: LifecycleStore, port: number) {
    this.dispatcher = dispatcher;
    this.store = store;
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });
    console.log(`[ws] 🌐 WsServer initialized on port ${port}`);
  }

  start(): void {
    this.httpServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);

      const welcome: WsEvent = {
        type: "payment:update",
        payload: {
          message: "Solana Pay Dispatcher connected",
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(welcome));

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });

    // Wire lifecycle tracker status transitions to WebSocket broadcast
    this.dispatcher.config.tracker.on("statusChange", (paymentId, status, event) => {
      const payment = this.store.getPayment(paymentId);
      if (payment) {
        const submissions = this.store.getBundleSubmissions(paymentId);
        const decisions = this.store.getAgentDecisions(paymentId);

        this.broadcast("payment:update", {
          paymentId,
          status,
          amountUsdc: payment.amountLamports / 1_000_000,
          recipientPubkey: payment.recipientPubkey,
          memo: payment.memo,
          tokenMint: payment.tokenMint,
          attempts: submissions.length || 1,
          agentInvoked: decisions.length > 0,
          submittedSlot: submissions[submissions.length - 1]?.submittedSlot,
          finalizedSlot: status === "FINALIZED" ? event.slot : undefined,
          updatedAt: Date.now(),
        });
      } else {
        this.broadcast("payment:update", {
          paymentId,
          status,
          updatedAt: Date.now(),
        });
      }
    });

    this.dispatcher.on("bundleSubmitted", (submission) => {
      this.broadcast("bundle:submitted", submission);
    });

    this.dispatcher.on("agentDecision", (paymentId, decision) => {
      this.broadcast("agent:decision", { paymentId, ...decision as object });
    });

    this.dispatcher.on("retryNotification", (paymentId, attempt, diagnosis, succeeded) => {
      this.broadcastRetryNotification(paymentId, attempt, diagnosis, succeeded);
    });

    // Wire slot updates
    this.dispatcher.config.slotSubscriber.on("slot", (slotUpdate) => {
      this.broadcast("slot:update", { slot: slotUpdate.slot, timestamp: Date.now() });
    });

    // Wire network health updates
    this.dispatcher.config.healthMonitor.on("healthUpdate", (health) => {
      this.broadcast("network:health", {
        status: health.status,
        slotRate: health.slotRate,
        processedToConfirmedDeltaMs: health.processedToConfirmedDeltaMs,
        currentSlot: health.currentSlot,
        timestamp: Date.now(),
      });
    });

    // REST endpoints
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", clients: this.clients.size });
    });

    this.app.get("/payments", (_req, res) => {
      const payments = this.store.getAllPayments(20);
      res.json(payments);
    });

    this.app.post("/dispatch", async (req, res) => {
      try {
        const { recipient, amount, memo, tokenMint } = req.body as {
          recipient: string;
          amount: number;
          memo?: string;
          tokenMint?: string;
        };

        if (!recipient || !amount) {
          res.status(400).json({ error: "recipient and amount are required" });
          return;
        }

        const payment = await this.dispatcher.queuePayment({
          recipient,
          amount: Math.floor(amount * 1_000_000), // convert USDC to lamports
          memo,
          tokenMint,
        });

        res.json({ success: true, paymentId: payment.id });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    });

    // Batch dispatch: 12 payments, 2 with intentional fault injection for AI recovery demo
    this.app.post("/dispatch-batch", async (req, res) => {
      try {
        const { recipient, baseAmount, memo, tokenMint } = req.body as {
          recipient: string;
          baseAmount?: number;
          memo?: string;
          tokenMint?: string;
        };

        if (!recipient) {
          res.status(400).json({ error: "recipient is required" });
          return;
        }

        const TOTAL = 12;
        // Indices that will have faults injected (0-based)
        const FAULT_INDICES = new Set([3, 8]);
        const base = baseAmount ?? 10; // default 10 USDC per payment

        const paymentIds: string[] = [];
        const errors: string[] = [];

        this.broadcast("batch:started", {
          total: TOTAL,
          faultCount: FAULT_INDICES.size,
          timestamp: Date.now(),
        });

        for (let i = 0; i < TOTAL; i++) {
          try {
            const isFaulty = FAULT_INDICES.has(i);
            const amount = Math.floor((base + i) * 1_000_000); // vary amounts slightly
            const paymentMemo = isFaulty
              ? `[AI Recovery Test] Payment ${i + 1} of ${TOTAL}`
              : `Payment ${i + 1} of ${TOTAL}${memo ? ` — ${memo}` : ""}`;

            // For faulty payments, set injectFault on the request
            const payment = await this.dispatcher.queuePayment({
              recipient,
              amount,
              memo: paymentMemo,
              tokenMint,
              _injectFault: isFaulty ? "blockhash" : undefined,
            });
            paymentIds.push(payment.id);

            // Small stagger to avoid overwhelming RPC
            await new Promise((r) => setTimeout(r, 300));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Payment ${i + 1}: ${msg}`);
          }
        }

        res.json({
          success: true,
          total: TOTAL,
          queued: paymentIds.length,
          faultCount: FAULT_INDICES.size,
          paymentIds,
          errors: errors.length ? errors : undefined,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: msg });
      }
    });

    this.httpServer.listen(this.port, () => {
      console.log(`[ws] ✅ Server listening on port ${this.port}`);
    });
  }

  broadcast(type: WsEventType, payload: unknown): void {
    const event: WsEvent = {
      type,
      payload,
      timestamp: Date.now(),
    };
    const data = JSON.stringify(event);
    let count = 0;

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        count++;
      }
    }

    if (count > 0) {
      console.log(`[ws] 📡 Broadcast ${type} to ${count} clients`);
    }
  }

  broadcastRetryNotification(
    paymentId: string,
    attempt: number,
    diagnosis: string,
    succeeded: boolean
  ): void {
    this.broadcast("notification:retry", {
      paymentId,
      attempt,
      diagnosis,
      succeeded,
      timestamp: Date.now(),
    });
  }

  stop(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    this.wss?.close();
    this.httpServer?.close();

    console.log("[ws] 🛑 WsServer stopped");
  }
}
