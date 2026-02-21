process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));

const express = require("express");
const { startHeliusMonitor } = require("./helius-monitor");
const app = express();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";

let recentBuys = [];
const MAX_RECENT_BUYS = 50;
const DEDUPE_SIG_ENTRIES = 200;

function addBuy(buy) {
  if (!buy?.wallet || buy.solSpent <= 0) return;
  const sig = buy.sig || "";
  const recentSigs = recentBuys.slice(0, DEDUPE_SIG_ENTRIES).map((b) => b.sig).filter(Boolean);
  if (sig && recentSigs.includes(sig)) return;
  recentBuys.unshift({ wallet: buy.wallet, sol: buy.solSpent, time: Date.now(), sig });
  if (recentBuys.length > MAX_RECENT_BUYS) recentBuys.pop();
}

function onMonitorBuy(buyData) {
  const wallet = typeof buyData.buyer === "string" ? buyData.buyer : buyData.buyer?.pubkey || "";
  if (!wallet) return;
  addBuy({ wallet, solSpent: buyData.solAmount, sig: buyData.signature || "" });
  console.log("WS BUY:", wallet, buyData.solAmount);
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/status", (req, res) => res.json({ ok: true }));
app.get("/buys", (req, res) => res.json(recentBuys));

app.post("/helius", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
  startHeliusMonitor({
    apiKey: HELIUS_API_KEY,
    tokenMint: TRACKED_TOKEN_MINT,
    onBuy: onMonitorBuy
  });
});
