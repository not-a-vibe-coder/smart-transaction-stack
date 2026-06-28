// Main entry point — bootstraps and wires all modules.
import { env, validateConnections } from "./config";
import { SolanaRpcClient } from "./core/rpc/client";
import { createGeyserClient } from "./core/stream/geyser";
import { SlotSubscriber } from "./core/stream/slot-subscriber";
import { LeaderDetector } from "./core/stream/leader-detector";
import { ReconnectionManager } from "./core/stream/reconnect";
import { NetworkHealthMonitor } from "./core/stream/network-health";
import { TipFetcher } from "./core/bundle/tip-fetcher";
import { TipCalculator } from "./core/bundle/tip-calculator";
import { InstructionBuilder } from "./core/bundle/instruction-builder";
import { BundleConstructor } from "./core/bundle/bundle-constructor";
import { BundleSubmitter } from "./core/bundle/submitter";
import { FailureClassifier } from "./core/bundle/failure-classifier";
import { LifecycleTracker } from "./core/lifecycle/tracker";
import { ConfirmationListener } from "./core/lifecycle/confirmation-listener";
import { ReceiptGenerator } from "./core/lifecycle/receipt-generator";
import { createStore } from "./core/db/store";
import { AgentClient } from "./agent/client";
import { RetryExecutor } from "./agent/retry-executor";
import { createFaultInjector } from "./agent/fault-injector";
import { PayDispatcher } from "./dispatcher";
import { WsServer } from "./server/ws-server";

const start = async (): Promise<void> => {
  console.log("[startup] 🚀 Starting Solana Pay Dispatcher...");

  const { connection, wallet } = await validateConnections();

  const rpc = new SolanaRpcClient(connection);
  const store = createStore(env.DB_PATH);
  const geyser = createGeyserClient();
  const slotSubscriber = new SlotSubscriber(geyser, connection);
  const leaderDetector = new LeaderDetector(rpc, slotSubscriber);
  const reconnectionManager = new ReconnectionManager(geyser, slotSubscriber);
  const healthMonitor = new NetworkHealthMonitor(slotSubscriber);
  const tipFetcher = new TipFetcher(env.JITO_BLOCK_ENGINE_URL);
  const tipCalculator = new TipCalculator(tipFetcher, healthMonitor);
  const instructionBuilder = new InstructionBuilder(connection, rpc);
  const bundleConstructor = new BundleConstructor(
    rpc,
    instructionBuilder,
    tipFetcher,
    wallet
  );
  const bundleSubmitter = new BundleSubmitter(
    leaderDetector,
    store,
    env.JITO_BLOCK_ENGINE_URL
  );
  const failureClassifier = new FailureClassifier();
  const tracker = new LifecycleTracker(store);
  const confirmationListener = new ConfirmationListener(geyser, tracker, connection);
  const receiptGenerator = new ReceiptGenerator(store);
  const agentClient = new AgentClient(
    env.ANTHROPIC_API_KEY || env.GEMINI_API_KEY || "",
    env.AGENT_MAX_RETRIES,
    env.AI_PROVIDER
  );
  const retryExecutor = new RetryExecutor(
    agentClient,
    bundleConstructor,
    bundleSubmitter,
    failureClassifier,
    tracker,
    store,
    healthMonitor,
    rpc,
    tipFetcher,
    env.AGENT_MAX_RETRIES
  );
  const faultInjector = createFaultInjector();

  const dispatcher = new PayDispatcher({
    connection,
    wallet,
    store,
    rpcClient: rpc,
    geyserClient: geyser,
    slotSubscriber,
    leaderDetector,
    reconnectionManager,
    healthMonitor,
    tipFetcher,
    tipCalculator,
    instructionBuilder,
    bundleConstructor,
    bundleSubmitter,
    failureClassifier,
    tracker,
    confirmationListener,
    receiptGenerator,
    agentClient,
    retryExecutor,
    faultInjector,
  });

  const server = new WsServer(dispatcher, store, env.SERVER_PORT);

  await tipFetcher.initialize();
  await dispatcher.start();
  server.start();

  console.log("[startup] ✅ Solana Pay Dispatcher is live.");
  console.log(`[startup] 🌐 Network: ${env.SOLANA_NETWORK}`);
  console.log(`[startup] 📡 WebSocket: ws://localhost:${env.SERVER_PORT}`);
  console.log(`[startup] 🏥 Health: http://localhost:${env.SERVER_PORT}/health`);

  process.on("SIGINT", async () => {
    console.log("\n[startup] 🛑 SIGINT received, shutting down...");
    server.stop();
    await dispatcher.stop();
    process.exit(0);
  });
};

void start();
