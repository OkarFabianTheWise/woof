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
      console.log("TX TYPE:", tx.type);
      console.log("HAS events:", !!tx.events);
      console.log("HAS swap:", !!tx.events?.swap);
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
