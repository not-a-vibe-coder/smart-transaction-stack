const fetch = require('node-fetch');

async function testGetStats() {
  const url = 'https://testnet.block-engine.jito.wtf/api/v1/bundles/getTipStatistics';
  try {
    const res = await fetch(url);
    console.log('GET Stats Status:', res.status);
    const text = await res.text();
    console.log('GET Stats Body:', text);
  } catch (err) {
    console.error('GET Stats Error:', err.message);
  }
}

async function testJsonRpcStats() {
  const url = 'https://testnet.block-engine.jito.wtf/api/v1/bundles';
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTipStatistics',
    params: []
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('JSON-RPC Stats Status:', res.status);
    const json = await res.json();
    console.log('JSON-RPC Stats Body:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('JSON-RPC Stats Error:', err.message);
  }
}

async function main() {
  await testGetStats();
  await testJsonRpcStats();
}

main();
