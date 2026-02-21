process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

const express = require("express");
const WebSocket = require("ws");
const app = express();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_SOL = 0.001;

let recentBuys = [];
const PROCESSED_SIGS_MAX = 500;
const processedSignatures = new Set();

function parseBalanceAmount(uiTokenAmount) {
  if (!uiTokenAmount) return 0;
  const s = uiTokenAmount.uiAmountString ?? String(uiTokenAmount.uiAmount ?? 0);
  const n = parseFloat(s, 10);
  return Number.isFinite(n) ? n : 0;
}

async function getTransactionPrePost(signature) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
    })
  });
  if (!res.ok) return { pre: [], post: [] };
  const json = await res.json();
  const meta = json?.result?.meta;
  return {
    pre: Array.isArray(meta?.preTokenBalances) ? meta.preTokenBalances : [],
    post: Array.isArray(meta?.postTokenBalances) ? meta.postTokenBalances : []
  };
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
    const preTracked = (preByOwner[owner] && preByOwner[owner][TRACKED_TOKEN_MINT]) || 0;
    const postTracked = (postByOwner[owner] && postByOwner[owner][TRACKED_TOKEN_MINT]) || 0;
    const preWSOL = (preByOwner[owner] && preByOwner[owner][WSOL_MINT]) || 0;
    const postWSOL = (postByOwner[owner] && postByOwner[owner][WSOL_MINT]) || 0;
    const trackedDelta = postTracked - preTracked;
    const wsolDelta = postWSOL - preWSOL;
    if (trackedDelta > 0 && wsolDelta < 0) {
      const solSpent = Math.abs(wsolDelta);
      if (solSpent >= MIN_SOL) buyers.push({ wallet: owner, solSpent });
    }
  }
  return buyers;
}

function detectBuyFromTx(tx) {
  if (tx?.transactionError) return null;
  const swap = tx?.events?.swap;
  if (!swap) return null;
  const hasTrackedOut = swap.tokenOutputs?.some(o => o?.mint === TRACKED_TOKEN_MINT);
  if (!hasTrackedOut) return null;
  let solSpent = 0;
  if (swap.nativeInput && swap.nativeInput > 0) {
    solSpent = Number(swap.nativeInput);
  } else {
    const wsolInput = swap.tokenInputs?.find(i => i?.mint === WSOL_MINT);
    if (wsolInput) solSpent = Number(wsolInput.tokenAmount || 0);
  }
  if (solSpent <= 0 || !swap.userAccount) return null;
  return { wallet: swap.userAccount, solSpent, sig: tx.signature };
}

function pushBuy(wallet, solSpent, sig) {
  recentBuys.unshift({ wallet, sol: solSpent, time: Date.now(), sig });
  if (recentBuys.length > 15) recentBuys.pop();
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/status", (req, res) => {
  res.json({ ok: true });
});

app.get("/buys", (req, res) => {
  res.json(recentBuys);
});

app.post("/helius", (req, res) => {
  try {
    const txs = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of txs) {
      const buy = detectBuyFromTx(tx);
      if (!buy) continue;
      pushBuy(buy.wallet, buy.solSpent, buy.sig);
      console.log("BUY:", buy.wallet, buy.solSpent);
    }

    res.json({ ok: true });
  } catch (e) {
    console.log("Webhook error:", e.message);
    res.json({ ok: true });
  }
});

function startHeliusWebSocket() {
  try {
    const ws = new WebSocket(
      `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    );

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "logsSubscribe",
          params: [
            { mentions: [] },
            { commitment: "processed" }
          ]
        }));
      } catch (err) {
        console.error("WS send on open:", err.message);
      }
    });

  ws.on("error", () => {});

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString() || "{}");
      const signature = data?.params?.result?.value?.signature;
      if (!signature) return;

      if (processedSignatures.has(signature)) return;
      if (processedSignatures.size >= PROCESSED_SIGS_MAX) {
        const first = processedSignatures.values().next().value;
        if (first !== undefined) processedSignatures.delete(first);
      }
      processedSignatures.add(signature);

      const { pre, post } = await getTransactionPrePost(signature);
      const buyers = detectBuysFromPrePost(pre, post);
      for (const { wallet, solSpent } of buyers) {
        recentBuys.unshift({ wallet, sol: solSpent, time: Date.now(), sig: signature });
        if (recentBuys.length > 15) recentBuys.pop();
        console.log("WS BUY:", wallet, solSpent);
      }
    } catch (e) {}
  });

    ws.on("close", () => {
      setTimeout(startHeliusWebSocket, 3000);
    });
  } catch (err) {
    console.error("startHeliusWebSocket:", err.message);
  }
}

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startHeliusWebSocket();
});
