// ===== WALLET ATTACHMENT: the player's own wallets, EVM and Solana, in one place =====
//
// One object, `Wallet`, with two families behind it. Everything else in the game asks this and
// never touches `window.ethereum` itself, because that global is a fight between every extension
// installed and whoever loaded last wins. EIP-6963 is the fix for that and it is used here: wallets
// announce themselves, the player picks by name, and the picked one is the one that gets used.
//
// WHAT THIS DOES NOT DO: it never holds a key, never stores a seed, and never asks for one. It
// connects, it asks for a signature, and it asks the wallet to send a payment the player can read
// in their own wallet popup before they approve it. The amount and the destination always come from
// a server invoice, so there is nothing in here that can quietly change where money goes.
//
// Solana needs a transaction built and signed, which needs real code, so @solana/web3.js is loaded
// from a CDN the FIRST TIME a Solana payment is actually started and never before. Nobody who pays
// in ETH downloads it.
(() => {
  const SOL_WEB3 = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.iife.min.js';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // --------------------------------------------------------------------------------- small tools
  const hex = n => '0x' + BigInt(n).toString(16);
  const pad32 = s => String(s).replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const short = (a, n = 4) => (!a ? '' : a.length <= 2 * n + 3 ? a : a.slice(0, n + 2) + '…' + a.slice(-n));
  function b58encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let out = '';
    while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
    return out || '1';
  }
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(Wallet.state()); } catch (e) { /* a listener must never break a payment */ } } };

  let cdn = null;
  function loadSolWeb3() {
    if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3);
    if (cdn) return cdn;
    cdn = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SOL_WEB3; s.async = true;
      s.onload = () => window.solanaWeb3 ? res(window.solanaWeb3) : rej(new Error('Solana library loaded but did not register.'));
      s.onerror = () => { cdn = null; rej(new Error('Could not load the Solana library. Check the connection and try again.')); };
      document.head.appendChild(s);
    });
    return cdn;
  }

  // =============================================================================== EVM
  // EIP-6963 discovery. Wallets announce on an event, and asking for the announcement is how a
  // wallet that loaded before this file still gets found. Everything is kept, keyed by its rdns.
  const evmFound = new Map();
  function noteProvider(detail) {
    if (!detail || !detail.info || !detail.provider) return;
    const info = detail.info;
    const key = info.rdns || info.uuid || info.name;
    if (!key) return;
    const had = evmFound.has(key);
    evmFound.set(key, { id: key, name: info.name || key, icon: info.icon || null, provider: detail.provider });
    if (!had) emit();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('eip6963:announceProvider', e => noteProvider(e.detail));
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) { /* older browser */ }
    // Ask again shortly: an extension that injects late misses the first request.
    setTimeout(() => { try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch (e) {} }, 1200);
  }

  // 76b_wallets.js (another session's) is the EVM front end when it is in the build: it owns the
  // wallet picker, the phone deep links, the network add for chain 4663 and the readable errors,
  // and it stands in for window.ethereum so every old call site keeps working. There is no reason
  // for a second picker, so when it is there this file asks IT and does nothing itself.
  // The check is lazy because that file is concatenated AFTER this one.
  function wal() { try { return typeof WAL !== 'undefined' && WAL ? WAL : null; } catch (e) { return null; } }

  const Evm = {
    picked: null, addr: null, chainId: null, busy: false,

    // Everything that announced itself, plus the plain injected provider if it never did. A wallet
    // that only does the old global still has to work.
    list() {
      const W = wal();
      if (W) {
        const found = (W.list() || []).map(d => ({ id: (d.info && (d.info.rdns || d.info.name)) || 'wallet', name: (d.info && d.info.name) || 'Wallet', icon: (d.info && d.info.icon) || null }));
        return found.length ? found : [{ id: 'wal', name: W.name || 'Wallet', icon: null }];
      }
      const out = [...evmFound.values()].map(w => ({ id: w.id, name: w.name, icon: w.icon }));
      const eth = window.ethereum;
      if (eth && !out.length) {
        const name = eth.isMetaMask ? 'MetaMask' : eth.isRabby ? 'Rabby' : eth.isCoinbaseWallet ? 'Coinbase Wallet' : 'Browser wallet';
        out.push({ id: 'injected', name, icon: null });
      }
      return out;
    },
    providerFor(id) {
      const W = wal();
      if (W) return { request: o => W.request(o) };   // the proxy, so its picker and deep links run
      if (id && evmFound.has(id)) return evmFound.get(id).provider;
      if (evmFound.size === 1) return [...evmFound.values()][0].provider;
      if (window.ethereum) return window.ethereum;
      return null;
    },
    get provider() { const W = wal(); if (W) return { request: o => W.request(o) }; return this.picked ? this.providerFor(this.picked) : null; },

    async connect(id) {
      const W = wal();
      if (W) {
        // Its own picker, its own errors. It already remembers the last wallet used.
        const a = await W.connect();
        const addr = Array.isArray(a) ? a[0] : (a && a.address) || a || W.addr;
        if (!addr) throw new Error('That wallet did not hand over an address.');
        this.picked = 'wal'; this.addr = String(addr).toLowerCase();
        try { this.chainId = Number(BigInt(await W.request({ method: 'eth_chainId' }))); } catch (e) { this.chainId = null; }
        if (!this.__walHooked && W.onChange) { this.__walHooked = true; W.onChange(() => { Evm.addr = W.addr ? String(W.addr).toLowerCase() : null; emit(); }); }
        emit();
        return { address: this.addr, chainId: this.chainId };
      }
      const p = this.providerFor(id);
      if (!p) throw new Error('No EVM wallet found in this browser. Install MetaMask, Rabby or Coinbase Wallet, then reload.');
      const accts = await p.request({ method: 'eth_requestAccounts' });
      const a = (accts || [])[0];
      if (!a) throw new Error('That wallet did not hand over an address.');
      this.picked = id && evmFound.has(id) ? id : (evmFound.size ? [...evmFound.keys()][0] : 'injected');
      this.addr = a.toLowerCase();
      this.chainId = Number(BigInt(await p.request({ method: 'eth_chainId' })));
      // Follow the wallet rather than trusting what it said once: people switch account and chain
      // mid-session and a stale address is a payment sent from somewhere nobody expected.
      if (!p.__bsHooked) {
        p.__bsHooked = true;
        p.on && p.on('accountsChanged', list => { Evm.addr = (list || [])[0] ? String(list[0]).toLowerCase() : null; emit(); });
        p.on && p.on('chainChanged', c => { Evm.chainId = Number(BigInt(c)); emit(); });
      }
      emit();
      return { address: this.addr, chainId: this.chainId };
    },
    disconnect() { this.picked = null; this.addr = null; this.chainId = null; emit(); },

    async sign(text) {
      if (!this.addr) await this.connect();
      return this.provider.request({ method: 'personal_sign', params: ['0x' + Array.from(new TextEncoder().encode(text)).map(b => b.toString(16).padStart(2, '0')).join(''), this.addr] });
    },

    // Put the wallet on the invoice's chain, adding the network if the wallet has never seen it.
    // Robinhood Chain is the one most wallets will not know, which is exactly why this is here.
    async switchTo(chainId, chainName, rpc, explorer) {
      const W = wal();
      if (W && W.ensureChain) {
        await W.ensureChain({ chainId, chainName, rpc, rpcUrls: rpc ? [rpc] : [], explorer });
        this.chainId = Number(chainId); emit(); return;
      }
      const want = '0x' + Number(chainId).toString(16);
      const p = this.provider;
      if (Number(BigInt(await p.request({ method: 'eth_chainId' }))) === Number(chainId)) return;
      try {
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
      } catch (e) {
        if (e && e.code !== 4902) throw e;
        await p.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: want, chainName: chainName || ('Chain ' + chainId),
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: rpc ? [rpc] : [], blockExplorerUrls: explorer ? [explorer] : [],
        }] });
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
      }
      this.chainId = Number(chainId);
      emit();
    },

    // `inv` is a server invoice. The amount and the destination are its numbers, never this file's.
    async pay(inv) {
      if (!this.addr) await this.connect();
      await this.switchTo(inv.chainId, inv.chainName, inv.rpc, inv.explorer);
      const value = BigInt(inv.send);
      const tx = inv.kind === 'native'
        ? { from: this.addr, to: inv.payTo, value: hex(value) }
        // transfer(address,uint256)
        : { from: this.addr, to: inv.token, data: '0xa9059cbb' + pad32(inv.payTo) + pad32(value.toString(16)) };
      return this.provider.request({ method: 'eth_sendTransaction', params: [tx] });
    },
  };

  // =============================================================================== SOLANA
  // Injected discovery. Phantom, Solflare and Backpack all expose themselves slightly differently,
  // so each is looked for by name rather than trusting one global.
  function solCandidates() {
    const out = [];
    const add = (id, name, provider) => { if (provider && !out.some(o => o.provider === provider)) out.push({ id, name, provider }); };
    const w = window;
    add('phantom', 'Phantom', w.phantom && w.phantom.solana);
    add('solflare', 'Solflare', w.solflare);
    add('backpack', 'Backpack', w.backpack && w.backpack.solana ? w.backpack.solana : (w.xnft && w.xnft.solana));
    // The bare global, last, and only if it is not one of the above wearing a different hat.
    if (w.solana) add(w.solana.isPhantom ? 'phantom' : 'solana', w.solana.isPhantom ? 'Phantom' : 'Solana wallet', w.solana);
    return out;
  }

  const Sol = {
    picked: null, addr: null,

    list() { return solCandidates().map(c => ({ id: c.id, name: c.name, icon: null })); },
    providerFor(id) {
      const all = solCandidates();
      return (id && all.find(c => c.id === id) || all[0] || {}).provider || null;
    },
    get provider() { return this.providerFor(this.picked); },

    async connect(id) {
      const p = this.providerFor(id);
      if (!p) throw new Error('No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, then reload.');
      const res = await p.connect();
      const key = (res && res.publicKey) || p.publicKey;
      if (!key) throw new Error('That wallet did not hand over an address.');
      this.picked = id || (solCandidates().find(c => c.provider === p) || {}).id || 'solana';
      this.addr = key.toString();
      if (!p.__bsHooked) {
        p.__bsHooked = true;
        p.on && p.on('accountChanged', k => { Sol.addr = k ? k.toString() : null; emit(); });
        p.on && p.on('disconnect', () => { Sol.addr = null; emit(); });
      }
      emit();
      return { address: this.addr };
    },
    disconnect() { try { this.provider && this.provider.disconnect && this.provider.disconnect(); } catch (e) {} this.picked = null; this.addr = null; emit(); },

    async sign(text) {
      if (!this.addr) await this.connect();
      const p = this.provider;
      if (!p.signMessage) throw new Error('That wallet cannot sign a message. Attach it by paying with it once instead.');
      const res = await p.signMessage(new TextEncoder().encode(text), 'utf8');
      const sig = (res && res.signature) || res;
      return b58encode(sig instanceof Uint8Array ? sig : new Uint8Array(sig));
    },

    // Build the transfer, hand it to the wallet, let the player read it and approve it.
    async pay(inv) {
      if (!this.addr) await this.connect();
      const web3 = await loadSolWeb3();
      const { PublicKey, Transaction, SystemProgram, TransactionInstruction, Connection } = web3;
      const from = new PublicKey(this.addr);
      const to = new PublicKey(inv.payTo);
      const amount = BigInt(inv.send);
      const tx = new Transaction();

      if (inv.kind === 'native') {
        tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: amount }));
      } else {
        const mint = new PublicKey(inv.token);
        const tokenProgram = new PublicKey(TOKEN_PROGRAM);
        const ataProgram = new PublicKey(ATA_PROGRAM);
        const ata = owner => PublicKey.findProgramAddressSync(
          [owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ataProgram)[0];
        const src = ata(from);
        const dst = ata(to);
        // Create the destination token account if it is not there yet, idempotently, so the first
        // person ever to pay in this token does not simply fail. Instruction 1 on the ATA program
        // is a no-op when the account already exists.
        tx.add(new TransactionInstruction({
          programId: ataProgram,
          keys: [
            { pubkey: from, isSigner: true, isWritable: true },
            { pubkey: dst, isSigner: false, isWritable: true },
            { pubkey: to, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
            { pubkey: tokenProgram, isSigner: false, isWritable: false },
          ],
          data: new Uint8Array([1]),
        }));
        // TransferChecked (instruction 12): it carries the mint and the decimals, so the token
        // program itself refuses a transfer of the wrong thing. Transfer (3) cannot do that.
        const data = new Uint8Array(10);
        data[0] = 12;
        let a = amount;
        for (let i = 1; i <= 8; i++) { data[i] = Number(a & 0xffn); a >>= 8n; }
        data[9] = inv.decimals;
        tx.add(new TransactionInstruction({
          programId: tokenProgram,
          keys: [
            { pubkey: src, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: dst, isSigner: false, isWritable: true },
            { pubkey: from, isSigner: true, isWritable: false },
          ],
          data,
        }));
      }

      // A memo carrying the invoice id, so a payment can still be found later if the tab dies
      // before the hash is handed back. Costs nothing and it is the only free audit trail Solana
      // offers.
      if (inv.id) {
        tx.add(new TransactionInstruction({
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          keys: [], data: new TextEncoder().encode(inv.id),
        }));
      }

      tx.feePayer = from;
      const conn = new Connection(inv.rpc || 'https://api.mainnet-beta.solana.com', 'confirmed');
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;

      const p = this.provider;
      if (p.signAndSendTransaction) {
        const res = await p.signAndSendTransaction(tx);
        return (res && (res.signature || res)) || null;
      }
      const signed = await p.signTransaction(tx);
      return conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    },
  };

  // =============================================================================== the facade
  const Wallet = {
    evm: Evm, sol: Sol, short, b58encode,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    off(fn) { listeners.delete(fn); },
    state() {
      return {
        evm: { wallets: Evm.list(), address: Evm.addr, chainId: Evm.chainId, picked: Evm.picked },
        sol: { wallets: Sol.list(), address: Sol.addr, picked: Sol.picked },
      };
    },
    family(f) { return f === 'sol' ? Sol : Evm; },
    addressFor(f) { return f === 'sol' ? Sol.addr : Evm.addr; },
    // Is a wallet of this family even installed? The checkout uses this to say "install Phantom"
    // rather than opening a picker with nothing in it.
    available(f) { return (f === 'sol' ? Sol.list() : Evm.list()).length > 0; },
    async connect(f, id) { return f === 'sol' ? Sol.connect(id) : Evm.connect(id); },
    async sign(f, text) { return f === 'sol' ? Sol.sign(text) : Evm.sign(text); },
    async pay(inv) { return inv.family === 'sol' ? Sol.pay(inv) : Evm.pay(inv); },
  };

  window.Wallet = Wallet;
})();
