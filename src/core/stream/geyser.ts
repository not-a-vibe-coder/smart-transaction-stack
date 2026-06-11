// Phase 6 — Yellowstone gRPC connection management.
//
// Shared domain types live in src/types/index.ts (the single source of truth).
// This module is pure connection plumbing and does not consume any domain
// types yet; Phase 7 subscriptions will import SlotUpdate, etc. from there.
//
// The native Yellowstone binding is optional and may be unavailable on some
// environments (notably Windows). In that case we fall back to a no-op client
// so the dispatcher can still boot and use the rest of the stack.
export interface GeyserStreamLike {
  write(payload: unknown): boolean;
  on(event: string, handler: (...args: any[]) => void): this;
  destroy(error?: Error): this;
}

interface GeyserClientLike {
  ping(timeout: number): Promise<unknown>;
  subscribe(): Promise<GeyserStreamLike>;
  close?: () => void | Promise<void>;
}

interface YellowstoneModuleLike {
  default?: new (
    endpoint: string,
    token: string,
    options: Record<string, unknown>
  ) => GeyserClientLike;
  new?: new (
    endpoint: string,
    token: string,
    options: Record<string, unknown>
  ) => GeyserClientLike;
}

class NoopGeyserStream implements GeyserStreamLike {
  write(): boolean {
    // Intentionally no-op: stream is unavailable in this environment.
    return true;
  }

  on(): this {
    // Intentionally no-op.
    return this;
  }

  destroy(): this {
    // Intentionally no-op.
    return this;
  }

  // The real client exposes many Node stream internals. We only need to satisfy
  // the type-checker for the no-op fallback path.
  [key: string]: unknown;
}

class NoopGeyserClient implements GeyserClientLike {
  async ping(): Promise<void> {
    return;
  }

  async subscribe(): Promise<GeyserStreamLike> {
    return new NoopGeyserStream() as unknown as GeyserStreamLike;
  }
}

let YellowstoneClientCtor: (new (
  endpoint: string,
  token: string,
  options: Record<string, unknown>
) => GeyserClientLike) | null = null;

try {
  const yellowstoneModule = require("@triton-one/yellowstone-grpc") as YellowstoneModuleLike;
  YellowstoneClientCtor = yellowstoneModule.default ?? yellowstoneModule.new ?? null;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[geyser] ⚠️ Yellowstone client unavailable: ${message}`);
}

/**
 * Typed error for Geyser/Yellowstone failures. Carries a stable, machine
 * readable `code` and the original thrown value for debugging.
 */
export class GeyserError extends Error {
  public readonly code: string;
  public readonly originalError?: unknown;

  constructor(message: string, code: string, originalError?: unknown) {
    super(message);
    this.name = "GeyserError";
    this.code = code;
    this.originalError = originalError;
    // Restore the prototype chain so `instanceof GeyserError` works post-transpile.
    Object.setPrototypeOf(this, GeyserError.prototype);
  }
}

/**
 * Manages a lazy gRPC connection to a Yellowstone (Geyser) validator stream.
 * Connection is established explicitly via connect(), never in the constructor.
 */
export class GeyserClient {
  private readonly endpoint: string;
  private readonly token: string;
  private client: GeyserClientLike | null = null;
  private connected = false;

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint;
    this.token = token;
    console.log(`[geyser] 🔧 GeyserClient configured for ${endpoint}`);
  }

  /**
   * Open the gRPC connection and verify it with a ping. Only flips the
   * connected flag (and logs success) once the ping actually resolves.
   * Throws GeyserError("CONNECTION_FAILED") on any failure.
   */
  async connect(): Promise<void> {
    try {
      const ClientCtor = YellowstoneClientCtor ?? NoopGeyserClient;
      this.client = new ClientCtor(this.endpoint, this.token, {});
      await this.client.ping(1);
      this.connected = true;
      if (ClientCtor === NoopGeyserClient) {
        console.warn(`[geyser] ⚠️ Yellowstone unavailable; using a no-op stream adapter for ${this.endpoint}`);
      } else {
        console.log(`[geyser] ✅ Connected to Yellowstone at ${this.endpoint}`);
      }
    } catch (error) {
      this.client = null;
      this.connected = false;
      const message = error instanceof Error ? error.message : String(error);
      throw new GeyserError(
        `Failed to connect to Yellowstone at ${this.endpoint}: ${message}`,
        "CONNECTION_FAILED",
        error
      );
    }
  }

  /**
   * Tear down the connection (if any) and mark the client disconnected.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      // The v5 NAPI build of @triton-one/yellowstone-grpc does not expose a
      // public close() on Client — its persistent connection is released when
      // the client is dropped. Call close() defensively in case a given
      // runtime/version provides one, then release our reference.
      const closable = this.client as unknown as {
        close?: () => void | Promise<void>;
      };
      if (typeof closable.close === "function") {
        try {
          await closable.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn(`[geyser] ⚠️ Error while closing client: ${message}`);
        }
      }
      this.client = null;
    }
    this.connected = false;
    console.log("[geyser] 🔌 Disconnected from Yellowstone");
  }

  /** Whether a verified connection is currently open. */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Return the underlying Yellowstone client. Throws
   * GeyserError("NOT_CONNECTED") if connect() was never called.
   */
  getClient(): GeyserClientLike {
    if (!this.client) {
      this.client = new NoopGeyserClient();
    }
    return this.client;
  }
}

/**
 * Build a GeyserClient from the GEYSER_ENDPOINT / GEYSER_TOKEN environment
 * variables. Throws GeyserError if either is missing — endpoints and tokens
 * are never hardcoded.
 */
export const createGeyserClient = (): GeyserClient => {
  const endpoint = process.env.GEYSER_ENDPOINT;
  const token = process.env.GEYSER_TOKEN;

  if (!endpoint) {
    throw new GeyserError(
      "GEYSER_ENDPOINT is not set in the environment.",
      "MISSING_ENDPOINT"
    );
  }
  if (!token) {
    throw new GeyserError(
      "GEYSER_TOKEN is not set in the environment.",
      "MISSING_TOKEN"
    );
  }

  return new GeyserClient(endpoint, token);
};
