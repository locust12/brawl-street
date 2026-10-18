// A stand-in for a browser wallet extension, for the wager test only.
// Two throwaway keys (anvil dev accounts) behind a tiny HTTP endpoint the page's injected
// EIP-1193 shim calls. It signs and broadcasts to the local fork; it never sees a real key.
//   node signer.cjs <port> <rpc>
const http = require('http');
const { createWalletClient, createPublicClient, http: vhttp, defineChain } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const PORT = +process.argv[2] || 19100;
const RPC = process.argv[3] || 'http://127.0.0.1:18777';
const KEYS = {
  a: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',   // anvil #3
  b: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',   // anvil #4
};
const chain = defineChain({ id: 42161, name: 'Arbitrum fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: vhttp(RPC) });
const who = {};
for (const k of Object.keys(KEYS)) {
  const account = privateKeyToAccount(KEYS[k]);
  who[k] = { account, wc: createWalletClient({ account, chain, transport: vhttp(RPC) }) };
  console.log('player', k, account.address);
}

const raw = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
};

async function handle(slot, method, params) {
  const { account, wc } = who[slot];
  switch (method) {
    case 'eth_chainId': return '0xa4b1';
    case 'eth_accounts':
    case 'eth_requestAccounts': return [account.address];
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain': return null;
    case 'personal_sign': {
      const [data] = params;
      return wc.signMessage({ message: { raw: data } });
    }
    case 'eth_sendTransaction': {
      const t = params[0];
      const hash = await wc.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined });
      const rc = await pub.waitForTransactionReceipt({ hash });
      console.log(slot, 'tx', hash, rc.status, 'gas', rc.gasUsed.toString());
      if (rc.status !== 'success') throw new Error('transaction reverted');
      return hash;
    }
    default: return raw(method, params);
  }
}

http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const slot = req.url.replace(/^\//, '').split('?')[0];
  if (!who[slot]) { res.writeHead(404, cors); return res.end('{"error":"no such player"}'); }
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', async () => {
    let out;
    try { const { method, params } = JSON.parse(body); out = { result: await handle(slot, method, params) }; }
    catch (e) { out = { error: String(e && e.message || e) }; console.log(slot, 'ERR', out.error.slice(0, 200)); }
    res.writeHead(200, cors); res.end(JSON.stringify(out));
  });
}).listen(PORT, '127.0.0.1', () => console.log('signer on', PORT, '->', RPC));
