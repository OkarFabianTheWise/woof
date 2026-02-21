process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));

const express = require("express");
const WebSocket = require("ws");
const app = express();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_WS = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_SOL = 0.001;
const POOL_VAULT_ACCOUNTS = new Set([]);

let recentBuys = [];
const sigQueue = [];
const sigSeen = new Set();
let working = false;

function enqueueSig(sig) {
  if (!sig || sigSeen.has(sig)) return;
  sigSeen.add(sig);
  sigQueue.push(sig);
  if (sigSeen.size > 5000) sigSeen.clear();
}

function parseBalanceAmount(uiTokenAmount) {
  if (!uiTokenAmount) return 0;
  const s = uiTokenAmount.uiAmountString ?? String(uiTokenAmount.uiAmount ?? 0);
  const n = parseFloat(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function detectBuysFromPrePost(pre, post) {
  const preByOwner = Object.create(null);
  const postByOwner = Object.create(null);
  for (const e of pre) {
    if (!e.owner || !e.mint) continue;
    if (!preByOwner[e.owner]) preByOwner[e.owner] = Object.create(null);
    preByOwner[e.owner][e.mint] = (preByOwner[e.owner][e.mint] || 0) + parseBalanceAmount(e.uiTokenAmount);
  }
  for (const e of post) {
    if (!e.owner || !e.mint) continue;
    if (!postByOwner[e.owner]) postByOwner[e.owner] = Object.create(null);
    postByOwner[e.owner][e.mint] = (postByOwner[e.owner][e.mint] || 0) + parseBalanceAmount(e.uiTokenAmount);
  }
  const owners = new Set([...Object.keys(preByOwner), ...Object.keys(postByOwner)]);
  const buyers = [];
  for (const owner of owners) {
    if (POOL_VAULT_ACCOUNTS.has(owner)) continue;
    const preTracked = (preByOwner[owner] && preByOwner[owner][TRACKED_TOKEN_MINT]) || 0;
    const postTracked = (postByOwner[owner] && postByOwner[owner][TRACKED_TOKEN_MINT]) || 0;
    const preWSOL = (preByOwner[owner] && preByOwner[owner][WSOL_MINT]) || 0;
    const postWSOL = (postByOwner[owner] && postByOwner[owner][WSOL_MINT]) || 0;
    const deltaTracked = postTracked - preTracked;
    const deltaWSOL = postWSOL - preWSOL;
    if (deltaTracked > 0 && deltaWSOL < 0) {
      const solSpent = Math.abs(deltaWSOL);
      if (solSpent >= MIN_SOL) buyers.push({ wallet: owner, solSpent });
    }
  }
  return buyers;
}

async function handleSignature(sig) {
  let res;
  try {
    res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
      })
    });
  } catch (err) {
    return;
  }
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1000));
    return;
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    return;
  }
  const text = JSON.stringify(json);
  if (text.includes("429")) {
    await new Promise((r) => setTimeout(r, 1000));
    return;
  }
  const meta = json?.result?.meta;
  const pre = Array.isArray(meta?.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta?.postTokenBalances) ? meta.postTokenBalances : [];
  const buyers = detectBuysFromPrePost(pre, post);
  for (const { wallet, solSpent } of buyers) {
    recentBuys.unshift({ wallet, sol: solSpent, time: Date.now() });
    if (recentBuys.length > 50) recentBuys.pop();
    console.log("WS BUY:", wallet, solSpent);
  }
}

function detectBuyFromTx(tx) {
  if (tx?.transactionError) return null;
  const swap = tx?.events?.swap;
  if (!swap) return null;
  const hasTrackedOut = swap.tokenOutputs?.some((o) => o?.mint === TRACKED_TOKEN_MINT);
  if (!hasTrackedOut) return null;
  let solSpent = 0;
  if (swap.nativeInput && swap.nativeInput > 0) {
    solSpent = Number(swap.nativeInput);
  } else {
    const wsolInput = swap.tokenInputs?.find((i) => i?.mint === WSOL_MINT);
    if (wsolInput) solSpent = Number(wsolInput.tokenAmount || 0);
  }
  if (solSpent <= 0 || !swap.userAccount) return null;
  return { wallet: swap.userAccount, solSpent, sig: tx.signature };
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/status", (req, res) => res.json({ ok: true }));
app.get("/buys", (req, res) => res.json(recentBuys));

app.post("/helius", (req, res) => {
  try {
    const txs = Array.isArray(req.body) ? req.body : [req.body];
    for (const tx of txs) {
      const buy = detectBuyFromTx(tx);
      if (!buy) continue;
      recentBuys.unshift({ wallet: buy.wallet, sol: buy.solSpent, time: Date.now() });
      if (recentBuys.length > 50) recentBuys.pop();
      console.log("BUY:", buy.wallet, buy.solSpent);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

setInterval(async () => {
  if (working) return;
  const sig = sigQueue.shift();
  if (!sig) return;
  working = true;
  try {
    await handleSignature(sig);
  } catch (err) {
    console.error("handleSignature:", err?.message || err);
  } finally {
    working = false;
  }
}, 150);

function startHeliusWebSocket() {
  console.log("HELIUS_API_KEY:", process.env.HELIUS_API_KEY);
  try {
    console.log("Connecting to:", HELIUS_WS);
    const ws = new WebSocket(HELIUS_WS);
    ws.on("open", () => {
      console.log("WS OPEN EVENT FIRED");
      console.log("Helius WebSocket connected");
      try {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "logsSubscribe",
            params: [{ mentions: [TRACKED_TOKEN_MINT] }, { commitment: "processed" }]
          })
        );
        console.log("Subscription message sent");
      } catch (err) {}
    });
    ws.on("error", () => {});
    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString() || "{}");
        const signature = data?.params?.result?.value?.signature;
        if (!signature) return;
        enqueueSig(signature);
      } catch (e) {}
    });
    ws.on("close", () => setTimeout(startHeliusWebSocket, 3000));
  } catch (err) {
    console.error("startHeliusWebSocket:", err?.message || err);
  }
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
  startHeliusWebSocket();
});
