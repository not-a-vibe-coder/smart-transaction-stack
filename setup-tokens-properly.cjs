const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const { execSync } = require('child_process');

dotenv.config();

const secretKey = bs58.decode(process.env.PAYER_PRIVATE_KEY);
const keypairPath = path.join(__dirname, 'payer.json');
fs.writeFileSync(keypairPath, JSON.stringify(Array.from(secretKey)));
console.log('Saved temporary payer.json.');

function run(cmd) {
  console.log(`Running: ${cmd}`);
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

try {
  // Create a brand new token
  const createOutput = run(`spl-token --url devnet create-token --decimals 6 --fee-payer "${keypairPath}"`);
  console.log(createOutput);
  
  // Extract token address
  const match = createOutput.match(/Creating token (\w+)/);
  if (!match) {
    throw new Error('Failed to parse token address');
  }
  const mint = match[1];
  console.log('Created token mint:', mint);
  
  // Create token account explicitly owned by our dispatcher wallet
  const walletPubkey = '53owyhFdxjkvJRZL9weMgLfYGhjoRgDLrLhB63Khiooa';
  const createAccountOutput = run(`spl-token --url devnet create-account ${mint} --owner ${walletPubkey} --fee-payer "${keypairPath}"`);
  console.log(createAccountOutput);
  
  // Extract ATA address
  const matchAccount = createAccountOutput.match(/Creating account (\w+)/);
  if (!matchAccount) {
    throw new Error('Failed to parse ATA address');
  }
  const ata = matchAccount[1];
  console.log('Parsed ATA address:', ata);
  
  // Mint tokens directly to the ATA address
  const mintOutput = run(`spl-token --url devnet mint ${mint} 1000000 ${ata} --fee-payer "${keypairPath}"`);
  console.log(mintOutput);
  
  console.log('\nSUCCESS! Token setup completed properly.');
  console.log('Token Mint address:', mint);
  console.log('Owner of ATA:', walletPubkey);
  console.log('ATA Address:', ata);
  
  // Clean up payer.json for security
  fs.unlinkSync(keypairPath);
  console.log('Cleaned up payer.json.');
} catch (err) {
  console.error('Error during token setup:', err.message);
  if (fs.existsSync(keypairPath)) {
    fs.unlinkSync(keypairPath);
  }
}
