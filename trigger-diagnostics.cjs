const dotenv = require('dotenv');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } = require('@solana/spl-token');

dotenv.config();

const connection = new Connection(process.env.RPC_ENDPOINT, 'confirmed');
const secretKey = bs58.decode(process.env.PAYER_PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);

const mint = new PublicKey('6ewNP5Dh79SsXQbcXyv7rfBcZGXo9Xi4C3xvRQtAom7');

async function main() {
  const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);
  const blockhash = await connection.getLatestBlockhash('confirmed');
  
  const instructions = [
    createTransferCheckedInstruction(
      ata,
      mint,
      ata,
      wallet.publicKey,
      1000n,
      6
    )
  ];
  
  const msg = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions,
  }).compileToV0Message();
  
  const tx = new VersionedTransaction(msg);
  
  // Simulate unsigned
  console.log('Simulating unsigned...');
  const sim1 = await connection.simulateTransaction(tx);
  console.log('Unsigned result:', JSON.stringify(sim1.value));
  
  // Simulate signed
  console.log('Simulating signed...');
  tx.sign([wallet]);
  const sim2 = await connection.simulateTransaction(tx);
  console.log('Signed result:', JSON.stringify(sim2.value));
}

main();
