import dotenv from "dotenv";
import bs58 from "bs58";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { z } from "zod";

dotenv.config();

export const EnvSchema = z.object({
  SOLANA_NETWORK: z.enum(["devnet", "testnet", "mainnet-beta"]),
  RPC_ENDPOINT: z.string().url(),
  GEYSER_ENDPOINT: z.string(),
  GEYSER_TOKEN: z.string(),
  JITO_BLOCK_ENGINE_URL: z.string().url(),
  PAYER_PRIVATE_KEY: z.string().min(32),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal("")),
  GEMINI_API_KEY: z.string().optional().or(z.literal("")),
  AI_PROVIDER: z.enum(["anthropic", "gemini"]).default("gemini"),
  SERVER_PORT: z.coerce.number().default(3001),
  AGENT_MAX_RETRIES: z.coerce.number().default(3),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  INJECT_FAULT: z
    .enum(["blockhash", "low_fee", "leader_skip", "none"])
    .default("none"),
  DB_PATH: z.string().default("./logs/dispatcher.db")
}).superRefine((data, ctx) => {
  if (data.AI_PROVIDER === "anthropic" && !data.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ANTHROPIC_API_KEY"],
      message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic",
    });
  }

  if (data.AI_PROVIDER === "gemini" && !data.GEMINI_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GEMINI_API_KEY"],
      message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini",
    });
  }
});

const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("[config] ❌ Invalid environment configuration:");
  for (const issue of parsedEnv.error.issues) {
    const key = issue.path.join(".") || "ENV";
    console.error(`[config] ❌ ${key}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsedEnv.data;

const truncatePublicKey = (publicKey: string): string =>
  `${publicKey.slice(0, 8)}...`;

export const loadWallet = (): Keypair => {
  try {
    const secretKey = bs58.decode(env.PAYER_PRIVATE_KEY);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to decode PAYER_PRIVATE_KEY. Expected a base58 encoded Solana private key: ${message}`
    );
  }
};

export const createConnection = (): Connection => {
  const connection = new Connection(env.RPC_ENDPOINT, "confirmed");
  console.log(`[config] 🔌 Connecting to ${env.SOLANA_NETWORK}`);
  return connection;
};

export const validateConnections = async (): Promise<{
  connection: Connection;
  wallet: Keypair;
  slot: number;
}> => {
  const connection = createConnection();
  const slot = await connection.getSlot();
  const wallet = loadWallet();
  const publicKey = wallet.publicKey.toBase58();
  const balanceLamports = await connection.getBalance(wallet.publicKey);
  const balanceSol = balanceLamports / LAMPORTS_PER_SOL;

  console.log(
    `[config] ✅ Connected to ${env.SOLANA_NETWORK} at slot ${slot}`
  );
  console.log(`[config] 👛 Wallet: ${truncatePublicKey(publicKey)}`);
  console.log(`[config] 💰 Balance: ${balanceSol} SOL`);

  if ((env.SOLANA_NETWORK === "devnet" || env.SOLANA_NETWORK === "testnet") && balanceLamports === 0) {
    console.warn(
      `[config] ⚠️ Balance is 0. Run: solana airdrop 2 ${publicKey} --url ${env.SOLANA_NETWORK}`
    );
  }

  return { connection, wallet, slot };
};
