const express = require("express");
const WebSocket = require("ws");
const app = express();

const HELIUS_WS = "wss://mainnet.helius-rpc.com/?api-key=1fffa47b-183b-4542-a4de-97a5cc1929f5";
const HELIUS_API_KEY = "1fffa47b-183b-4542-a4de-97a5cc1929f5";
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_SOL = 0.001;
/** Pool/vault accounts to exclude from buyer list (add known pool PDAs if needed) */
const POOL_VAULT_ACCOUNTS = new Set([]);

const recentBuys = [];

function parseBalanceAmount(uiTokenAmount) {
  if (!uiTokenAmount) return 0;
  const s = uiTokenAmount.uiAmountString ?? String(uiTokenAmount.uiAmount ?? 0);
  const n = parseFloat(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * BUY detection from preTokenBalances and postTokenBalances (no tokenTransfers).
 * For each owner: trackedDelta = postTracked - preTracked, wsolDelta = postWSOL - preWSOL.
 * If trackedDelta > 0 AND wsolDelta < 0 → BUY, solSpent = |wsolDelta|.
 * If trackedDelta < 0 AND wsolDelta > 0 → SELL (ignored).
 * Only push BUY wallets. Ignores pool vault accounts.
 */
function detectBuysFromPrePostBalances(preTokenBalances, postTokenBalances) {
  const pre = Array.isArray(preTokenBalances) ? preTokenBalances : [];
  const post = Array.isArray(postTokenBalances) ? postTokenBalances : [];

  const preByOwnerMint = Object.create(null);  // owner -> mint -> amount
  const postByOwnerMint = Object.create(null);

  for (const e of pre) {
    const owner = e.owner;
    const mint = e.mint;
    if (!owner || !mint) continue;
    if (!preByOwnerMint[owner]) preByOwnerMint[owner] = Object.create(null);
    preByOwnerMint[owner][mint] = (preByOwnerMint[owner][mint] || 0) + parseBalanceAmount(e.uiTokenAmount);
  }
  for (const e of post) {
    const owner = e.owner;
    const mint = e.mint;
    if (!owner || !mint) continue;
    if (!postByOwnerMint[owner]) postByOwnerMint[owner] = Object.create(null);
    postByOwnerMint[owner][mint] = (postByOwnerMint[owner][mint] || 0) + parseBalanceAmount(e.uiTokenAmount);
  }

  const allOwners = new Set([...Object.keys(preByOwnerMint), ...Object.keys(postByOwnerMint)]);
  const buyers = [];

  for (const owner of allOwners) {
    if (POOL_VAULT_ACCOUNTS.has(owner)) continue;

    const preTracked = (preByOwnerMint[owner] && preByOwnerMint[owner][TRACKED_TOKEN_MINT]) || 0;
    const postTracked = (postByOwnerMint[owner] && postByOwnerMint[owner][TRACKED_TOKEN_MINT]) || 0;
    const preWSOL = (preByOwnerMint[owner] && preByOwnerMint[owner][WSOL_MINT]) || 0;
    const postWSOL = (postByOwnerMint[owner] && postByOwnerMint[owner][WSOL_MINT]) || 0;

    const trackedDelta = postTracked - preTracked;
    const wsolDelta = postWSOL - preWSOL;

    if (trackedDelta > 0 && wsolDelta < 0) {
      const solSpent = Math.abs(wsolDelta);
      if (solSpent >= MIN_SOL) buyers.push({ wallet: owner, solSpent });
    }
    // trackedDelta < 0 && wsolDelta > 0 → SELL, do not push
  }
  return buyers;
}

/** Get preTokenBalances and postTokenBalances from raw getTransaction (when enhanced API doesn't include them). */
async function fetchPrePostBalances(signature) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
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

function getPrePostFromTx(tx) {
  const meta = tx?.meta;
  const pre = (meta && meta.preTokenBalances) || tx.preTokenBalances || [];
  const post = (meta && meta.postTokenBalances) || tx.postTokenBalances || [];
  return { pre: Array.isArray(pre) ? pre : [], post: Array.isArray(post) ? post : [] };
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

app.get("/status", (req, res) => {
  res.json({ ok: true });
});

app.get("/buys", (req, res) => {
  res.json(recentBuys);
});

app.post("/helius", async (req, res) => {
  try {
    const payload = req.body;
    const txs = Array.isArray(payload) ? payload : payload ? [payload] : [];

    for (const tx of txs) {
      if (tx?.transactionError) continue;

      let { pre, post } = getPrePostFromTx(tx);
      if (pre.length === 0 && post.length === 0 && tx.signature) {
        const fetched = await fetchPrePostBalances(tx.signature);
        pre = fetched.pre;
        post = fetched.post;
      }
      const buyers = detectBuysFromPrePostBalances(pre, post);

      for (const { wallet: buyer, solSpent } of buyers) {
        console.log("BUY:", tx.signature, "wallet:", buyer, "sol:", solSpent.toFixed(4));

        recentBuys.unshift({
          wallet: buyer,
          sol: solSpent,
          time: Date.now()
        });
        if (recentBuys.length > 100) recentBuys.pop();
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.log("ERROR:", err.message);
    res.status(200).json({ ok: true });
  }
});

function startHeliusWebSocket() {
  const ws = new WebSocket(HELIUS_WS);

  ws.on("open", () => {
    console.log("Helius WebSocket connected");

    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: [TRACKED_TOKEN_MINT] },
        { commitment: "processed" }
      ]
    }));
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (!data.params) return;

      const logInfo = data.params.result;
      const signature = logInfo.value.signature;

      // Always fetch full parsed transaction for final BUY detection (do not rely on logsSubscribe alone)
      const res = await fetch(
        `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: [signature] })
        }
      );
      if (!res.ok) return;
      const txs = await res.json();
      const list = Array.isArray(txs) ? txs : txs ? [txs] : [];

      for (const tx of list) {
        if (tx?.transactionError) continue;

        const sig = tx?.signature ?? signature;
        let { pre, post } = getPrePostFromTx(tx);
        if (pre.length === 0 && post.length === 0 && sig) {
          const fetched = await fetchPrePostBalances(sig);
          pre = fetched.pre;
          post = fetched.post;
        }
        const buyers = detectBuysFromPrePostBalances(pre, post);

        for (const { wallet: buyer, solSpent } of buyers) {
          console.log("WS BUY:", buyer, solSpent);

          recentBuys.unshift({
            wallet: buyer,
            sol: solSpent,
            time: Date.now()
          });
          if (recentBuys.length > 50) recentBuys.pop();
        }
      }
    } catch (e) {
      console.log("WS error parse:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("Helius WS closed. Reconnecting...");
    setTimeout(startHeliusWebSocket, 3000);
  });

  ws.on("error", (err) => {
    console.log("Helius WS error:", err.message);
  });
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server listening on port 3000");
  startHeliusWebSocket();
});
