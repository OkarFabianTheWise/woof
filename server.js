const express = require("express");
const app = express();

const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

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
      if (!tx?.events?.swap) continue;

      const swap = tx.events.swap;

      const outputs = Array.isArray(swap.tokenOutputs) ? swap.tokenOutputs : [];
      const buyOutput = outputs.find(o => o.mint === TRACKED_TOKEN_MINT);
      if (!buyOutput) continue;

      let solSpent = 0;

      if (swap.nativeInput && swap.nativeInput > 0) {
        solSpent = swap.nativeInput;
      } else {
        const inputs = Array.isArray(swap.tokenInputs) ? swap.tokenInputs : [];
        const wsolInput = inputs.find(i => i.mint === WSOL_MINT);
        if (wsolInput) {
          solSpent = Number(wsolInput.tokenAmount || 0);
        }
      }

      if (solSpent <= 0) continue;

      console.log(
        "BUY:",
        tx.signature,
        "wallet:",
        swap.userAccount,
        "sol:",
        solSpent
      );
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
