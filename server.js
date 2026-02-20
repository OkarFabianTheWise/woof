const express = require("express");
const app = express();

const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const MIN_SOL = 0.001;

app.use(express.json({ limit: "2mb" }));

app.get("/status", (req, res) => {
  res.json({ ok: true });
});

app.post("/helius", (req, res) => {
  try {
    const payload = req.body;
    const txs = Array.isArray(payload) ? payload : payload ? [payload] : [];

    for (const tx of txs) {
      if (tx?.transactionError) continue;

      const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
      const nativeChanges = Array.isArray(tx.nativeBalanceChanges) ? tx.nativeBalanceChanges : [];

      for (const transfer of transfers) {
        if (transfer.mint !== TRACKED_TOKEN_MINT) continue;
        if (!transfer.toUserAccount) continue;

        const buyer = transfer.toUserAccount;

        const native = nativeChanges.find(n => n.userAccount === buyer);
        if (!native) continue;
        if (native.nativeBalanceChange >= 0) continue;

        const solSpent = (-native.nativeBalanceChange) / 1e9;
        if (solSpent < MIN_SOL) continue;

        console.log(
          "BUY:",
          tx.signature,
          "wallet:",
          buyer,
          "sol:",
          solSpent.toFixed(4)
        );
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
