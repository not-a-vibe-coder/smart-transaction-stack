const fetch = require('node-fetch');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const url = 'http://localhost:3001/dispatch';
  const recipient = '53owyhFdxjkvJRZL9weMgLfYGhjoRgDLrLhB63Khiooa';
  const tokenMint = '6ewNP5Dh79SsXQbcXyv7rfBcZGXo9Xi4C3xvRQtAom7';

  console.log('Starting batch dispatch of 12 transactions...');

  for (let i = 1; i <= 12; i++) {
    console.log(`Sending payment request ${i}/12...`);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient,
          amount: 1000, // 0.001 standard custom tokens (1,000 base units)
          tokenMint,
          memo: `Batch payment ${i} validation`
        })
      });

      const body = await res.json();
      console.log(`Response ${i}:`, JSON.stringify(body));
    } catch (err) {
      console.error(`Error sending request ${i}:`, err.message);
    }
    await sleep(2500);
  }

  console.log('Batch dispatch complete!');
}

main();
