import express from "express";

// Module-level defaults (can be overridden by startHeliusMonitor)
let HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
let TOKEN_MINT = process.env.TRACKED_TOKEN_MINT || "BKQucpTXB2d67jSNXMznSTj2iNLVtyga9JW86QoWpump";
let WEBHOOK_PORT = process.env.PORT || 5000;
// Use hardcoded WEBHOOK_URL if set, otherwise use Render's external URL, then localhost fallback
let WEBHOOK_URL = process.env.WEBHOOK_URL || (process.env.RENDER_EXTERNAL_URL ? `https://${process.env.RENDER_EXTERNAL_URL}/webhook` : `http://localhost:${WEBHOOK_PORT}/webhook`);
let SERVER_URL = process.env.SERVER_URL || (process.env.RENDER_EXTERNAL_URL ? `https://${process.env.RENDER_EXTERNAL_URL}` : "http://localhost:3000"); // Backend server for storing buy events

// External callback provided by caller (server.js) to receive buy events
let externalOnBuy = null;

// ─── DELETE OLD WEBHOOKS ──────────────────────────────────────────────────────
// Helius has a webhook limit — stale ones from previous runs block new events.
async function deleteAllWebhooks() {
  const res = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`
  );
  const hooks = await res.json();
  if (!Array.isArray(hooks) || hooks.length === 0) return;

  console.log(`🧹 Deleting ${hooks.length} existing webhook(s)...`);
  for (const hook of hooks) {
    await fetch(
      `https://api.helius.xyz/v0/webhooks/${hook.webhookID}?api-key=${HELIUS_API_KEY}`,
      { method: "DELETE" }
    );
    console.log(`   Deleted: ${hook.webhookID} → ${hook.webhookURL}`);
  }
}

// ─── REGISTER WEBHOOK ─────────────────────────────────────────────────────────
async function registerWebhook() {
  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL: WEBHOOK_URL,
        transactionTypes: ["SWAP"],
        accountAddresses: [TOKEN_MINT],
        webhookType: "enhanced",
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to register webhook: ${err}`);
  }

  const data = await response.json();
  console.log("\n✅ Webhook registered!");
  console.log(`   Webhook ID : ${data.webhookID}`);
  console.log(`   Watching   : ${TOKEN_MINT}`);
  console.log(`   Endpoint   : ${WEBHOOK_URL}\n`);
  return data;
}

// ─── FORMAT HELPERS ───────────────────────────────────────────────────────────
function lamportsToSol(lamports) {
  return (lamports / 1_000_000_000).toFixed(6);
}

function formatTimestamp(unixTs) {
  return new Date(unixTs * 1000).toLocaleString();
}

// ─── BUY DETECTION ────────────────────────────────────────────────────────────
function isBuyOfToken(event) {
  const swap = event?.events?.swap;
  if (!swap) return false;
  const receivingOurToken = swap.tokenOutputs?.some((o) => o.mint === TOKEN_MINT);
  const payingWithSol = swap.nativeInput?.amount > 0;
  const payingWithToken = swap.tokenInputs?.some((i) => i.mint !== TOKEN_MINT);
  return receivingOurToken && (payingWithSol || payingWithToken);
}

// ─── LOG BUY ──────────────────────────────────────────────────────────────────
function logBuyEvent(event) {
  const { signature, timestamp, feePayer, fee, source, tokenTransfers, nativeTransfers, accountData, events } = event;
  const swap = events?.swap;

  console.log("━".repeat(60));
  console.log("🟢 BUY DETECTED");
  console.log("━".repeat(60));
  console.log(`  Signature  : ${signature}`);
  console.log(`  Time       : ${formatTimestamp(timestamp)}`);
  console.log(`  Source     : ${source}`);
  console.log(`  Buyer      : ${feePayer}`);
  console.log(`  Tx Fee     : ${lamportsToSol(fee)} SOL`);

  if (swap) {
    console.log("\n  🔄 Swap Summary:");
    if (swap.nativeInput?.amount > 0)
      console.log(`     Paid         : ${lamportsToSol(swap.nativeInput.amount)} SOL`);
    if (swap.tokenInputs?.length)
      for (const inp of swap.tokenInputs)
        console.log(`     Paid         : ${inp.rawTokenAmount?.tokenAmount} (mint: ${inp.mint})`);
    if (swap.tokenOutputs?.length)
      for (const out of swap.tokenOutputs)
        if (out.mint === TOKEN_MINT) {
          console.log(`     Received     : ${out.rawTokenAmount?.tokenAmount} tokens`);
          console.log(`     Mint         : ${out.mint}`);
        }
    if (swap.nativeFees?.length)
      for (const f of swap.nativeFees)
        console.log(`     Protocol Fee : ${lamportsToSol(f.amount)} SOL`);
  }

  const relevant = tokenTransfers?.filter((t) => t.mint === TOKEN_MINT);
  if (relevant?.length) {
    console.log("\n  📦 Token Transfers:");
    for (const t of relevant)
      console.log(`     ${t.fromUserAccount || "—"} → ${t.toUserAccount || "—"} : ${t.tokenAmount} tokens`);
  }

  if (nativeTransfers?.length) {
    console.log("\n  💸 SOL Transfers:");
    for (const t of nativeTransfers)
      console.log(`     ${t.fromUserAccount} → ${t.toUserAccount} : ${lamportsToSol(t.amount)} SOL`);
  }

  if (accountData?.length) {
    const changed = accountData.filter((a) => a.nativeBalanceChange !== 0);
    if (changed.length) {
      console.log("\n  📊 SOL Balance Changes:");
      for (const a of changed) {
        const sign = a.nativeBalanceChange > 0 ? "+" : "-";
        console.log(`     ${a.account}: ${sign}${lamportsToSol(Math.abs(a.nativeBalanceChange))} SOL`);
      }
    }
  }
  console.log("");

  // Extract buy amount and send to server
  const solAmount = swap?.nativeInput?.amount ? lamportsToSol(swap.nativeInput.amount) : 0;
  const tokensReceived = relevant?.[0]?.tokenAmount || swap?.tokenOutputs?.[0]?.rawTokenAmount?.tokenAmount || 0;

  sendBuyToServer({
    signature,
    timestamp,
    buyer: feePayer,
    solAmount: parseFloat(solAmount),
    tokensReceived: parseFloat(tokensReceived),
    source,
    txFee: lamportsToSol(fee),
  });
}

// ─── SEND BUY TO SERVER ────────────────────────────────────────────────────────
async function sendBuyToServer(buyData) {
  try {
    // If caller provided a callback, use it instead of posting to server
    if (typeof externalOnBuy === 'function') {
      try {
        externalOnBuy(buyData);
        console.log(`✅ Buy dispatched to external onBuy callback: ${buyData.buyer?.slice(0,8)}...`);
        return;
      } catch (cbErr) {
        console.error('❌ externalOnBuy callback threw:', cbErr && cbErr.message ? cbErr.message : cbErr);
      }
    }

    const response = await fetch(`${SERVER_URL}/api/buys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buyData),
    });

    if (response.ok) {
      console.log(`✅ Buy sent to server: ${buyData.buyer?.slice(0, 8)}... purchased ${buyData.solAmount} SOL worth`);
    } else {
      console.warn(`⚠️  Server responded with ${response.status}`);
    }
  } catch (err) {
    console.error("❌ Failed to send buy to server:", err.message);
  }
}

// ─── EXPRESS SERVER ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// DEBUG: log every incoming request so we know if Helius is reaching us at all
app.use((req, res, next) => {
  console.log(`📨 Incoming ${req.method} ${req.path} — body length: ${JSON.stringify(req.body).length} chars`);
  next();
});

app.post("/webhook", (req, res) => {
  const events = req.body;

  if (!Array.isArray(events)) {
    console.warn("⚠️  Payload is not an array:", JSON.stringify(events).slice(0, 300));
    return res.status(400).send("Invalid payload");
  }

  console.log(`📦 Received ${events.length} event(s)`);

  for (const event of events) {
    // Show every event type we're receiving so we can verify what Helius sends
    console.log(`   → type: ${event.type} | source: ${event.source} | sig: ${event.signature?.slice(0, 20)}...`);

    // DEBUG: dump swap event structure so we can verify isBuyOfToken logic
    const swap = event?.events?.swap;
    if (swap) {
      console.log(`      swap.nativeInput:  ${JSON.stringify(swap.nativeInput)}`);
      console.log(`      swap.tokenInputs:  ${JSON.stringify(swap.tokenInputs?.map(i => i.mint))}`);
      console.log(`      swap.tokenOutputs: ${JSON.stringify(swap.tokenOutputs?.map(o => o.mint))}`);
    } else {
      console.log(`      (no swap event block found)`);
    }

    if (event.type === "SWAP" && isBuyOfToken(event)) {
      logBuyEvent(event);
    }
  }

  res.status(200).send("OK");
});

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  app.listen(WEBHOOK_PORT, () => {
    console.log(`🚀 Webhook server listening on port ${WEBHOOK_PORT}`);
  });

  try {
    await deleteAllWebhooks();   // Clean up stale webhooks first
    await registerWebhook();
  } catch (err) {
    console.error("❌ Could not register webhook:", err.message);
  }
}

// Public API: startHeliusMonitor
export async function startHeliusMonitor({ apiKey, tokenMint, onBuy, webhookPort, webhookURL } = {}) {
  if (apiKey) HELIUS_API_KEY = apiKey;
  if (tokenMint) TOKEN_MINT = tokenMint;
  if (webhookPort) WEBHOOK_PORT = webhookPort;
  if (webhookURL) WEBHOOK_URL = webhookURL;
  externalOnBuy = typeof onBuy === 'function' ? onBuy : null;

  await main();
}