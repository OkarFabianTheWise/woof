const express = require("express");
const app = express();

const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const recentBuys = [];
const SEEN_SIGS_MAX = 2000;
const seenSigs = new Set();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

app.get("/status", (req, res) => {
  res.json({ ok: true });
});

app.get("/buys", (req, res) => {
  res.json(recentBuys);
});

app.post("/helius", (req, res) => {
  try {
    const payload = req.body;
    const txs = Array.isArray(payload) ? payload : payload ? [payload] : [];

    for (const tx of txs) {
      if (tx?.transactionError) continue;
      if (tx?.type !== "SWAP") continue;
      const swap = tx?.events?.swap;
      if (!swap) continue;

      const sig = tx.signature;
      if (seenSigs.has(sig)) continue;
      seenSigs.add(sig);
      if (seenSigs.size > SEEN_SIGS_MAX) {
        const first = seenSigs.values().next().value;
        if (first !== undefined) seenSigs.delete(first);
      }

      const tokenOutputs = Array.isArray(swap.tokenOutputs) ? swap.tokenOutputs : [];
      const hasTrackedOut = tokenOutputs.some((o) => o?.mint === TRACKED_TOKEN_MINT);
      if (!hasTrackedOut) continue;

      let solSpent = 0;
      if (swap.nativeInput > 0) {
        solSpent = Number(swap.nativeInput);
      } else {
        const tokenInputs = Array.isArray(swap.tokenInputs) ? swap.tokenInputs : [];
        const wsolInput = tokenInputs.find((i) => i?.mint === WSOL_MINT);
        if (wsolInput) solSpent = Number(wsolInput.tokenAmount || 0);
      }
      if (solSpent <= 0) continue;

      const wallet = swap.userAccount;
      if (!wallet) continue;

      recentBuys.unshift({
        wallet,
        sol: solSpent,
        time: Date.now(),
        sig: tx.signature
      });
      if (recentBuys.length > 50) recentBuys.pop();

      console.log("BUY sig=" + sig + " wallet=" + wallet + " sol=" + solSpent);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.log("ERROR:", err.message);
    res.status(200).json({ ok: true });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server listening on port 3000");
});
