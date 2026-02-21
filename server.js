const express = require("express");
const WebSocket = require("ws");
const app = express();

const HELIUS_WS = "wss://mainnet.helius-rpc.com/?api-key=1fffa47b-183b-4542-a4de-97a5cc1929f5";
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "1fffa47b-183b-4542-a4de-97a5cc1929f5";
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

let recentBuys = [];

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
  const ws = new WebSocket(HELIUS_WS);

  ws.on("open", () => {
    console.log("Helius WebSocket connected");
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: ["HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump"] },
        { commitment: "processed" }
      ]
    }));
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      const signature = data.params?.result?.value?.signature;
      if (!signature) return;

      const res = await fetch(
        `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: [signature] })
        }
      );
      if (!res.ok) return;
      const parsed = await res.json();
      const txs = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

      for (const tx of txs) {
        if (tx?.transactionError) continue;
        const swap = tx?.events?.swap;
        if (!swap) continue;
        const hasTrackedOut = swap.tokenOutputs?.some(o => o?.mint === TRACKED_TOKEN_MINT);
        if (!hasTrackedOut) continue;
        let solSpent = 0;
        if (swap.nativeInput > 0) {
          solSpent = Number(swap.nativeInput);
        } else {
          const wsolInput = swap.tokenInputs?.find(i => i?.mint === WSOL_MINT);
          if (wsolInput) solSpent = Number(wsolInput.tokenAmount || 0);
        }
        if (solSpent <= 0 || !swap.userAccount) continue;
        recentBuys.unshift({
          wallet: swap.userAccount,
          sol: solSpent,
          time: Date.now(),
          sig: signature
        });
        if (recentBuys.length > 15) recentBuys.pop();
        console.log("WS BUY:", swap.userAccount, solSpent);
      }
    } catch (e) {
      console.log("WS error:", e.message);
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
