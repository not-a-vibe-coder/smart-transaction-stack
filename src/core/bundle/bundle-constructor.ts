// Phase 14 — Jito bundle constructor.
import { randomUUID } from "crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { BlockhashWithExpiryBlockHeight } from "@solana/web3.js";
import type { PaymentRequest } from "../../types";
import type { InstructionBuilder } from "./instruction-builder";
import type { TipFetcher } from "./tip-fetcher";
import type { SolanaRpcClient } from "../rpc/client";

export class BundleConstructor {
  private readonly rpcClient: SolanaRpcClient;
  private readonly instructionBuilder: InstructionBuilder;
  private readonly tipFetcher: TipFetcher;
  private readonly payerKeypair: Keypair;

  constructor(
    rpcClient: SolanaRpcClient,
    instructionBuilder: InstructionBuilder,
    tipFetcher: TipFetcher,
    payerKeypair: Keypair
  ) {
    this.rpcClient = rpcClient;
    this.instructionBuilder = instructionBuilder;
    this.tipFetcher = tipFetcher;
    this.payerKeypair = payerKeypair;
    console.log("[bundle] 🏗️ BundleConstructor initialized");
  }

  async buildBundle(
    payment: PaymentRequest,
    tipLamports: number
  ): Promise<{ transactions: VersionedTransaction[]; bundleId: string }> {
    // MUST use confirmed commitment — never finalized
    const blockhash = await this.rpcClient.getLatestBlockhash();
    return this.buildBundleWithBlockhash(payment, tipLamports, blockhash);
  }

  async buildBundleWithBlockhash(
    payment: PaymentRequest,
    tipLamports: number,
    blockhash: BlockhashWithExpiryBlockHeight
  ): Promise<{ transactions: VersionedTransaction[]; bundleId: string }> {
    const transferInstructions =
      await this.instructionBuilder.buildTransferInstructions(
        payment,
        this.payerKeypair
      );

    // Payment transaction
    const paymentMsg = new TransactionMessage({
      payerKey: this.payerKeypair.publicKey,
      recentBlockhash: blockhash.blockhash,
      instructions: transferInstructions,
    }).compileToV0Message();
    const paymentTx = new VersionedTransaction(paymentMsg);
    paymentTx.sign([this.payerKeypair]);

    // Tip transaction
    const tipAccount = new PublicKey(this.tipFetcher.getRandomTipAccount());
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: this.payerKeypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    });
    const tipMsg = new TransactionMessage({
      payerKey: this.payerKeypair.publicKey,
      recentBlockhash: blockhash.blockhash,
      instructions: [tipInstruction],
    }).compileToV0Message();
    const tipTx = new VersionedTransaction(tipMsg);
    tipTx.sign([this.payerKeypair]);

    // Validate both transactions are signed
    if (paymentTx.signatures.length === 0 || tipTx.signatures.length === 0) {
      throw new Error("Bundle validation failed: unsigned transactions");
    }

    const bundleId = randomUUID();

    console.log(
      `[bundle] 📦 Bundle built: ${bundleId} tip: ${tipLamports} lamports, blockhash: ${blockhash.blockhash.slice(0, 8)}...`
    );

    return { transactions: [paymentTx, tipTx], bundleId };
  }
}
