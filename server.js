const express = require("express");
const WebSocket = require("ws");
const app = express();

const HELIUS_WS = "wss://mainnet.helius-rpc.com/?api-key=1fffa47b-183b-4542-a4de-97a5cc1929f5";
const HELIUS_API_KEY = "1fffa47b-183b-4542-a4de-97a5cc1929f5";
const TRACKED_TOKEN_MINT = "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MIN_SOL = 0.001;

const recentBuys = [];

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

function startHeliusWebSocket() {
  const ws = new WebSocket(HELIUS_WS);

  ws.on("open", () => {
    console.log("Helius WebSocket connected");

    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: [TRACKED_TOKEN_MINT] },
        { commitment: "processed" }
      ]
    }));
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (!data.params) return;

      const logInfo = data.params.result;
      const signature = logInfo.value.signature;

      // Always fetch full parsed transaction for final BUY detection (do not rely on logsSubscribe alone)
      const res = await fetch(
        `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions: [signature] })
        }
      );
      if (!res.ok) return;
      const txs = await res.json();
      const list = Array.isArray(txs) ? txs : txs ? [txs] : [];

      // Same BUY detection as webhook: TRACKED_TOKEN_MINT received + WSOL sent from same wallet
      for (const tx of list) {
        if (tx?.transactionError) continue;

        const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];

        for (const transfer of transfers) {
          if (transfer.mint !== TRACKED_TOKEN_MINT) continue;
          if (!transfer.toUserAccount) continue;

          const buyer = transfer.toUserAccount;

          const wsolOut = transfers.find(t =>
            t.mint === WSOL_MINT && t.fromUserAccount === buyer
          );
          if (!wsolOut) continue;

          const solSpent = Number(wsolOut.tokenAmount || 0);
          if (solSpent < MIN_SOL) continue;

          console.log("WS BUY:", buyer, solSpent);

          recentBuys.unshift({
            wallet: buyer,
            sol: solSpent,
            time: Date.now()
          });
          if (recentBuys.length > 50) recentBuys.pop();
        }
      }
    } catch (e) {
      console.log("WS error parse:", e.message);
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
