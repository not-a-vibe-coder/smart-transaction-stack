const http = require('http');
const dotenv = require('dotenv');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;
const { Keypair } = require('@solana/web3.js');

dotenv.config();

const secretKey = bs58.decode(process.env.PAYER_PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);
const pubkey = wallet.publicKey.toBase58();

console.log('Sending test payment to public key:', pubkey);

const data = JSON.stringify({
  recipient: pubkey,
  amount: 0.001, // 0.001 * 1,000,000 = 1000 base units (our balance is 1,000,000)
  memo: 'test payment',
  tokenMint: '6ewNP5Dh79SsXQbcXyv7rfBcZGXo9Xi4C3xvRQtAom7'
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/dispatch',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Response status:', res.statusCode);
    console.log('Response body:', body);
  });
});

req.on('error', (error) => {
  console.error('Error sending request:', error);
});

req.write(data);
req.end();
