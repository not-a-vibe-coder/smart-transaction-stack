import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction
} from "@solana/web3.js";
import type {
  BlockhashWithExpiryBlockHeight,
  Commitment
} from "@solana/web3.js";

/**
 * Result of a transaction simulation. Simulation failures are informational,
 * not fatal, so callers receive a structured object instead of an exception.
 */
export interface SimulationResult {
  success: boolean;
  logs: string[];
  unitsConsumed: number | null;
  error: string | null;
}

/**
 * Typed error for RPC failures. Carries a stable machine-readable `code`,
 * the number of attempts made, and the original thrown value for debugging.
 */
export class RpcError extends Error {
  public readonly code: string;
  public readonly retries: number;
  public readonly originalError: unknown;

  constructor(
    message: string,
    code: string,
    retries: number,
    originalError: unknown
  ) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.retries = retries;
    this.originalError = originalError;
    // Restore prototype chain for `instanceof` after transpilation to ES5/ES2022.
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

/** Resolve after `ms` milliseconds. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying up to `retries` total attempts with `delayMs` between
 * each. Logs every retry attempt (attempts 2..retries). Rethrows the last
 * error if all attempts fail.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  retries: number,
  delayMs: number,
  label: string
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (attempt > 1) {
      console.log(
        `[rpc] 🔁 Retrying ${label} (attempt ${attempt}/${retries})...`
      );
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[rpc] ⚠️ ${label} failed on attempt ${attempt}/${retries}: ${message}`
      );

      if (attempt < retries) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
};

/**
 * Thin, defensive wrapper around a @solana/web3.js Connection.
 *
 * Reads are pinned to the "confirmed" commitment so that downstream payment
 * logic never observes a finalized-but-stale or speculative-but-dropped state.
 */
export class SolanaRpcClient {
  private readonly connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
    console.log("[rpc] 🔌 RPC client initialized");
  }

  /**
   * Fetch a recent blockhash at "confirmed" commitment, retrying transient
   * failures. Throws a typed RpcError("BLOCKHASH_FETCH_FAILED") if all
   * attempts fail — a missing blockhash means we cannot build a transaction.
   */
  async getLatestBlockhash(): Promise<BlockhashWithExpiryBlockHeight> {
    const retries = 3;

    try {
      const result = await withRetry(
        () => this.connection.getLatestBlockhash("confirmed"),
        retries,
        500,
        "getLatestBlockhash"
      );

      console.log(
        `[rpc] 🧱 Blockhash: ${result.blockhash} (expires slot ${result.lastValidBlockHeight})`
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[rpc] ❌ Blockhash fetch failed after ${retries} attempts: ${message}`
      );
      throw new RpcError(
        `Failed to fetch latest blockhash after ${retries} attempts: ${message}`,
        "BLOCKHASH_FETCH_FAILED",
        retries,
        error
      );
    }
  }

  /**
   * Return the current slot. Errors propagate directly to the caller.
   */
  async getSlot(commitment: Commitment = "confirmed"): Promise<number> {
    const slot = await this.connection.getSlot(commitment);
    console.log(`[rpc] 🎰 Current slot: ${slot} (${commitment})`);
    return slot;
  }

  /**
   * Simulate a versioned transaction at "confirmed" commitment. A simulation
   * error is informational: it is logged as a warning and returned in the
   * result, never thrown.
   */
  async simulateTransaction(
    transaction: VersionedTransaction
  ): Promise<SimulationResult> {
    const response = await this.connection.simulateTransaction(transaction, {
      commitment: "confirmed"
    });

    const { err, logs, unitsConsumed } = response.value;
    const success = err === null;

    const result: SimulationResult = {
      success,
      logs: logs ?? [],
      unitsConsumed: unitsConsumed ?? null,
      error: success
        ? null
        : typeof err === "string"
          ? err
          : JSON.stringify(err)
    };

    if (!success) {
      console.warn(`[rpc] ⚠️ Simulation reported an error: ${result.error}`);
    }

    console.log(
      `[rpc] 🧪 Simulation: ${success ? "success" : "FAILED"} — ${
        result.unitsConsumed ?? "unknown"
      } CU`
    );

    return result;
  }

  /**
   * Return the human-readable UI amount for an SPL token account. Throws a
   * typed RpcError("TOKEN_ACCOUNT_NOT_FOUND") if the account is missing or
   * has no decodable balance.
   */
  async getTokenAccountBalance(tokenAccount: PublicKey): Promise<number> {
    const address = tokenAccount.toBase58();

    try {
      const response = await this.connection.getTokenAccountBalance(
        tokenAccount,
        "confirmed"
      );
      const uiAmount = response.value.uiAmount;

      if (uiAmount === null) {
        throw new RpcError(
          `Token account ${address} returned no UI amount`,
          "TOKEN_ACCOUNT_NOT_FOUND",
          0,
          null
        );
      }

      console.log(
        `[rpc] 🪙 Token balance: ${uiAmount} (${address.slice(0, 8)}...)`
      );
      return uiAmount;
    } catch (error) {
      if (error instanceof RpcError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[rpc] ❌ Token account ${address.slice(0, 8)}... unreadable: ${message}`
      );
      throw new RpcError(
        `Token account ${address} not found or unreadable: ${message}`,
        "TOKEN_ACCOUNT_NOT_FOUND",
        0,
        error
      );
    }
  }

  /** Expose the underlying Connection for callers that need raw RPC methods. */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Return an account's balance in SOL (lamports converted to SOL).
   */
  async getBalance(pubkey: PublicKey): Promise<number> {
    const lamports = await this.connection.getBalance(pubkey, "confirmed");
    const sol = lamports / LAMPORTS_PER_SOL;
    console.log(
      `[rpc] 💰 Balance: ${sol} SOL (${pubkey.toBase58().slice(0, 8)}...)`
    );
    return sol;
  }
}
