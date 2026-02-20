const express = require("express");
const app = express();

app.get("/status", (req, res) => {
  res.json({ ok: true });
});

const PORT = 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server listening on port", PORT);
});
