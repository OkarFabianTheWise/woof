const express = require("express");
const app = express();

const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

let recentBuys = [];

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
      if (tx?.transactionError) continue;
      if (tx?.type !== "SWAP") continue;
      if (!tx?.events?.swap) continue;

      const swap = tx.events.swap;

      const buyOutput = swap.tokenOutputs?.find(
        o => o.mint === TRACKED_TOKEN_MINT
      );
      if (!buyOutput) continue;

      let solSpent = 0;

      if (swap.nativeInput && swap.nativeInput > 0) {
        solSpent = swap.nativeInput;
      } else {
        const wsolInput = swap.tokenInputs?.find(
          i => i.mint === WSOL_MINT
        );
        if (wsolInput) {
          solSpent = Number(wsolInput.tokenAmount || 0);
        }
      }

      if (solSpent <= 0) continue;

      recentBuys.unshift({
        wallet: swap.userAccount,
        sol: solSpent,
        time: Date.now(),
        sig: tx.signature
      });

      if (recentBuys.length > 50) recentBuys.pop();

      console.log("BUY:", swap.userAccount, solSpent);
    }

    res.json({ ok: true });
  } catch (e) {
    console.log("Webhook error:", e.message);
    res.json({ ok: true });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server listening on port 3000");
});
