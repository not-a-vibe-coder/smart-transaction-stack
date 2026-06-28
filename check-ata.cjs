const dotenv = require('dotenv');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');

dotenv.config();

const connection = new Connection(process.env.RPC_ENDPOINT, 'confirmed');
const secretKey = bs58.decode(process.env.PAYER_PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);

const mint = new PublicKey('6ewNP5Dh79SsXQbcXyv7rfBcZGXo9Xi4C3xvRQtAom7');

async function main() {
  const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);
  console.log('getAssociatedTokenAddress:', ata.toBase58());
  
  try {
    const acc = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, wallet.publicKey);
    console.log('getOrCreateAssociatedTokenAccount address:', acc.address.toBase58());
    console.log('Balance:', acc.amount.toString());
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
