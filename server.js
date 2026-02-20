const express = require("express");
const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/status", (req, res) => {
  res.json({ ok: true });
});

app.post("/helius", (req, res) => {
  console.log("WEBHOOK HIT");
  console.log("BODY TYPE:", Array.isArray(req.body) ? "array" : typeof req.body);
  res.status(200).json({ ok: true });
});

const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on port", PORT);
});
