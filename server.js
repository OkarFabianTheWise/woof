const express = require("express");
const app = express();

const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_SOL = 0.001;

const recentBuys = [];

app.use(express.json({ limit: "2mb" }));

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

      const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];

      for (const transfer of transfers) {
        if (transfer.mint !== TRACKED_TOKEN_MINT) continue;
        if (!transfer.toUserAccount) continue;

        const buyer = transfer.toUserAccount;

        const wsolOut = transfers.find(t =>
          t.mint === WSOL_MINT &&
          t.fromUserAccount === buyer
        );

        if (!wsolOut) continue;

        const solSpent = Number(wsolOut.tokenAmount || 0);
        if (solSpent < MIN_SOL) continue;

        console.log(
          "BUY:",
          tx.signature,
          "wallet:",
          buyer,
          "sol:",
          solSpent.toFixed(4)
        );

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

const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on port", PORT);
});
