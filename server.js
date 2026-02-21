process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));

const express = require("express");
const WebSocket = require("ws");
const app = express();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_WS = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

let recentBuys = [];
const MAX_RECENT_BUYS = 50;
const DEDUPE_SIG_ENTRIES = 200;

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

function addBuy(buy) {
  if (!buy?.wallet || buy.solSpent <= 0) return;
  const sig = buy.sig || "";
  const recentSigs = recentBuys.slice(0, DEDUPE_SIG_ENTRIES).map((b) => b.sig).filter(Boolean);
  if (sig && recentSigs.includes(sig)) return;
  recentBuys.unshift({ wallet: buy.wallet, sol: buy.solSpent, time: Date.now(), sig });
  if (recentBuys.length > MAX_RECENT_BUYS) recentBuys.pop();
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
      addBuy(buy);
      console.log("BUY:", buy.wallet, buy.solSpent);
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

function startHeliusWebSocket() {
  try {
    const ws = new WebSocket(HELIUS_WS);
    ws.on("open", () => {
      console.log("Helius WebSocket connected");
      try {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "logsSubscribe",
            params: [
              { mentions: ["HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump"] },
              { commitment: "processed" }
            ]
          })
        );
      } catch (err) {}
    });
    ws.on("error", () => {});
    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg.toString() || "{}");
        const signature = data?.params?.result?.value?.signature;
        if (!signature) return;

        console.log("WS SIG:", signature);

        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetch(
            `https://api.helius.xyz/v0/transactions/?api-key=${process.env.HELIUS_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transactions: [signature] })
            }
          );
          if (response.status !== 429) break;
          console.log("Enhanced API rate limited, retry " + (attempt + 1));
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }

        if (response.status !== 200) return;

        const txs = await response.json();
        if (!txs || !txs[0]) return;

        const tx = Array.isArray(txs) ? txs[0] : txs;
        const buy = detectBuyFromTx(tx);
        if (!buy) return;
        addBuy(buy);
        console.log("WS BUY:", buy.wallet, buy.solSpent);
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
