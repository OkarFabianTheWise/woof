import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { startHeliusMonitor } from './monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));
process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));

const app = express();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TRACKED_TOKEN_MINT = process.env.TRACKED_TOKEN_MINT || "BKQucpTXB2d67jSNXMznSTj2iNLVtyga9JW86QoWpump";

let recentBuys = [];
const MAX_RECENT_BUYS = 100;

function addBuy(buyData) {
  if (!buyData?.buyer && !buyData?.wallet) return;
  
  const sig = buyData.signature || "";
  const recentSigs = recentBuys.slice(0, 200).map((b) => b.sig).filter(Boolean);
  if (sig && recentSigs.includes(sig)) {
    console.log("⏭️ Duplicate buy, skipping:", sig);
    return;
  }
  
  // Normalize timestamp to milliseconds (Helius sends seconds)
  let time = buyData.timestamp || Date.now();
  if (typeof time === 'number' && time < 1e12) time = time * 1000;

  recentBuys.unshift({ 
    wallet: buyData.buyer || buyData.wallet, 
    sol: buyData.solAmount, 
    tokens: buyData.tokensReceived || 0,
    time: time, 
    sig,
    source: buyData.source || "unknown",
    txFee: buyData.txFee || 0,
  });
  
  if (recentBuys.length > MAX_RECENT_BUYS) recentBuys.pop();
  console.log("✅ BUY ADDED:", buyData.buyer || buyData.wallet, buyData.solAmount, "SOL | Total buys:", recentBuys.length);
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get("/status", (req, res) => res.json({ ok: true }));
app.get("/buys", (req, res) => res.json(recentBuys));

// API endpoint to add buys from webhook
app.post("/api/buys", (req, res) => {
  const buyData = req.body;
  addBuy(buyData);
  res.status(200).json({ success: true, totalBuys: recentBuys.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
  console.log("Starting Helius monitor for token:", TRACKED_TOKEN_MINT);
  
  startHeliusMonitor({
    apiKey: HELIUS_API_KEY,
    tokenMint: TRACKED_TOKEN_MINT,
    onBuy: (buyData) => {
      console.log("🔔 Buy detected:", buyData);
      addBuy(buyData);
    }
  });
});
