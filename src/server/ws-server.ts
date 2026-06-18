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

    // Wire dispatcher events to broadcast
    this.dispatcher.on("paymentQueued", (payment) => {
      this.broadcast("payment:update", {
        ...payment,
        status: "QUEUED",
      });
    });

    this.dispatcher.on("paymentFinalized", (receipt) => {
      this.broadcast("payment:update", receipt);
    });

    this.dispatcher.on("paymentFailed", (paymentId, reason) => {
      this.broadcast("payment:update", {
        paymentId,
        status: "FAILED",
        reason,
      });
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
        const { recipient, amount, memo } = req.body as {
          recipient: string;
          amount: number;
          memo?: string;
        };

        if (!recipient || !amount) {
          res.status(400).json({ error: "recipient and amount are required" });
          return;
        }

        const payment = await this.dispatcher.queuePayment({
          recipient,
          amount: Math.floor(amount * 1_000_000), // convert USDC to lamports
          memo,
        });

        res.json({ success: true, paymentId: payment.id });
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
