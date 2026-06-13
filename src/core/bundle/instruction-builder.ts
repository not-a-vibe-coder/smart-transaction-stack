// Phase 13 — USDC/USDG transfer instruction builder + recipient validation.
import {
  PublicKey,
  Connection,
  TransactionInstruction,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import type { RecipientValidation, PaymentRequest } from "../../types";
import { Network } from "../../types";
import type { SolanaRpcClient } from "../rpc/client";

export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDG_MINT_MAINNET = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";

export async function validateRecipient(
  address: string,
  network: string,
  connection: Connection
): Promise<RecipientValidation> {
  const net = network === "mainnet-beta" ? Network.MAINNET : Network.DEVNET;

  if (address.startsWith("0x")) {
    console.log(
      `[builder] 🔍 Recipient ${address.slice(0, 8)}...: INVALID — EVM address`
    );
    return {
      address,
      isValid: false,
      isEVMAddress: true,
      hasOnChainHistory: false,
      network: net,
      warningMessage:
        "This looks like an Ethereum address. Solana addresses do not start with 0x.",
    };
  }

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    console.log(
      `[builder] 🔍 Recipient ${address.slice(0, 8)}...: INVALID — bad format`
    );
    return {
      address,
      isValid: false,
      isEVMAddress: false,
      hasOnChainHistory: false,
      network: net,
      warningMessage: "Invalid Solana address format.",
    };
  }

  const accountInfo = await connection.getAccountInfo(pubkey);
  const hasHistory = accountInfo !== null;

  let warningMessage: string | undefined;
  if (!hasHistory) {
    warningMessage = `This address has no on-chain history on ${network}. Verify you have the correct address before sending.`;
  }

  const result: RecipientValidation = {
    address,
    isValid: true,
    isEVMAddress: false,
    hasOnChainHistory: hasHistory,
    network: net,
    warningMessage,
  };

  console.log(
    `[builder] 🔍 Recipient ${address.slice(0, 8)}...: valid${warningMessage ? " — " + warningMessage : ""}`
  );

  return result;
}

export class InstructionBuilder {
  private readonly connection: Connection;
  private readonly rpcClient: SolanaRpcClient;

  constructor(connection: Connection, rpcClient: SolanaRpcClient) {
    this.connection = connection;
    this.rpcClient = rpcClient;
  }

  async buildTransferInstructions(
    payment: PaymentRequest,
    payerKeypair: Keypair
  ): Promise<TransactionInstruction[]> {
    const sender = new PublicKey(payment.senderPubkey);
    const recipient = new PublicKey(payment.recipientPubkey);
    const tokenMint = new PublicKey(payment.tokenMint);
    const instructions: TransactionInstruction[] = [];

    console.log(
      `[builder] 🏗️ Building transfer: ${payment.amountLamports / 1e6} USDC → ${payment.recipientPubkey.slice(0, 8)}...`
    );

    // Get or create sender's ATA
    const senderATA = await getOrCreateAssociatedTokenAccount(
      this.connection,
      payerKeypair,
      tokenMint,
      sender
    );

    // Get recipient's ATA address
    const recipientATA = await getAssociatedTokenAddress(tokenMint, recipient);

    // Create recipient ATA if it doesn't exist
    const recipientAccountInfo = await this.connection.getAccountInfo(recipientATA);
    if (!recipientAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          payerKeypair.publicKey,
          recipientATA,
          recipient,
          tokenMint
        )
      );
    }

    // Build transfer instruction
    instructions.push(
      createTransferCheckedInstruction(
        senderATA.address,
        tokenMint,
        recipientATA,
        payerKeypair.publicKey,
        BigInt(payment.amountLamports),
        6 // USDC and USDG both use 6 decimals
      )
    );

    // Add memo if present
    if (payment.memo) {
      const memoInstruction = new TransactionInstruction({
        keys: [],
        programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        data: Buffer.from(payment.memo, "utf-8"),
      });
      instructions.push(memoInstruction);
    }

    // Simulate before returning
    const blockhash = await this.rpcClient.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: payerKeypair.publicKey,
      recentBlockhash: blockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const simTx = new VersionedTransaction(msg);
    const simResult = await this.rpcClient.simulateTransaction(simTx);

    if (!simResult.success) {
      const err = new Error(
        `simulation failed: ${simResult.error ?? "unknown"}`
      );
      (err as Error & { code: string }).code = "SIMULATION_FAILED";
      throw err;
    }

    console.log(
      `[builder] ✅ Instructions built (${instructions.length} instructions, simulation passed)`
    );

    return instructions;
  }
}
