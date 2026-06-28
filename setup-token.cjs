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
console.log('Saved payer.json keypair file.');

function run(cmd) {
  console.log(`Running: ${cmd}`);
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

try {
  // Create token
  const createOutput = run(`spl-token --url devnet create-token --decimals 6 --fee-payer "${keypairPath}"`);
  console.log(createOutput);
  
  // Extract token address
  const match = createOutput.match(/Creating token (\w+)/);
  if (!match) {
    throw new Error('Failed to parse token address from output');
  }
  const mint = match[1];
  console.log('Created token mint:', mint);
  
  // Create account
  const createAccountOutput = run(`spl-token --url devnet create-account ${mint} --fee-payer "${keypairPath}"`);
  console.log(createAccountOutput);
  
  // Mint tokens (e.g. 1 million tokens, which with 6 decimals is 1,000,000.000000)
  const mintOutput = run(`spl-token --url devnet mint ${mint} 1000000 --fee-payer "${keypairPath}"`);
  console.log(mintOutput);
  
  console.log('\nSUCCESS! Token setup completed.');
  console.log('Use this Mint address in your trigger.cjs or update .env:');
  console.log('Mint Address:', mint);
  
  // Clean up payer.json for security
  fs.unlinkSync(keypairPath);
  console.log('Cleaned up payer.json keypair file.');
} catch (err) {
  console.error('Error during token setup:', err.message);
  if (fs.existsSync(keypairPath)) {
    fs.unlinkSync(keypairPath);
  }
}
