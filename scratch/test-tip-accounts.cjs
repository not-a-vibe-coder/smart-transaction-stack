const fetch = require('node-fetch');

async function main() {
  const url = 'https://testnet.block-engine.jito.wtf/api/v1/bundles';
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTipAccounts',
    params: []
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  console.log('Result:', JSON.stringify(json, null, 2));
}

main();
