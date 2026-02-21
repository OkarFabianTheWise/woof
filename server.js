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
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

let recentBuys = [];
const PROCESSED_SIGS_MAX = 500;
const processedSignatures = new Set();

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
      console.log("Helius WebSocket connected");
      console.log("Sending logsSubscribe...");
      try {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "logsSubscribe",
          params: [
            { mentions: ["HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump"] },
            { commitment: "processed" }
          ]
        }));
        console.log("Subscription sent.");
      } catch (err) {
        console.error("WS send on open:", err.message);
      }
    });

  ws.on("error", (err) => {
    console.error("WS error:", err.message);
  });

  ws.on("message", async (msg) => {
    console.log("WS RAW:", msg.toString());
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

      let txs;
      try {
        const res = await fetch(
          `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: [signature] })
          }
        );

        if (!res.ok) return;

        txs = await res.json();
      } catch (err) {
        return;
      }

      const list = Array.isArray(txs) ? txs : txs ? [txs] : [];
      for (const tx of list) {
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
