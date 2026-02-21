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

async function getTransactionMeta(signature) {
  const url = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || HELIUS_API_KEY}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed"
          }
        ]
      })
    });

    const data = await res.json();
    const tx = data?.result;

    if (tx && tx.meta) {
      return {
        pre: tx.meta.preTokenBalances || [],
        post: tx.meta.postTokenBalances || [],
        nativePre: tx.meta.preBalances || [],
        nativePost: tx.meta.postBalances || []
      };
    }

    await new Promise(r => setTimeout(r, 400));
  }

  return { pre: [], post: [], nativePre: [], nativePost: [] };
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
    const signatures = txs
      .filter((tx) => !tx?.transactionError && tx?.signature)
      .map((tx) => tx.signature);

    for (const sig of signatures) {
      const { pre, post } = await getTransactionMeta(sig);
      const buyers = detectBuysFromPrePostBalances(pre, post);

      for (const { wallet: buyer, solSpent } of buyers) {
        console.log("BUY:", sig, "wallet:", buyer, "sol:", solSpent.toFixed(4));

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

let wsFirstTxLogged = false;

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

      const { pre, post, nativePre, nativePost } = await getTransactionMeta(signature);
      if (!wsFirstTxLogged) {
        wsFirstTxLogged = true;
        console.log("SIGNATURE:", signature);
        console.log("PRE BALANCES:", JSON.stringify(pre, null, 2));
        console.log("POST BALANCES:", JSON.stringify(post, null, 2));
        console.log("NATIVE PRE/POST:", nativePre, nativePost);
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
