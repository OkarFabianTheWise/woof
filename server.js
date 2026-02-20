const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Tracked token mint address
const TRACKED_TOKEN_MINT = process.env.TRACKED_MINT || "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Global in-memory state
const state = {
    lastWebhookAt: null,
    lastWebhookSig: null,
    lastParsedBuy: null,
    counters: {
        webhooksReceived: 0,
        txProcessed: 0,
        buysBroadcasted: 0,
        buysSkipped: 0,
        parseErrors: 0
    }
};

// Create WebSocket server on /ws path
const wss = new WebSocket.Server({ 
    server,
    path: '/ws'
});

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`ws connect: clients=${clients.size}`);
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`ws disconnect: clients=${clients.size}`);
    });
    
    ws.on('error', (error) => {
        console.error('ws error:', error.message);
    });
});

app.use(express.json());

// Parse buy from Helius transaction
function parseBuyFromHeliusTx(tx) {
    if (tx?.transactionError != null) return null;

    const tokenTransfers = Array.isArray(tx?.tokenTransfers) ? tx.tokenTransfers : [];
    const nativeBalanceChanges = Array.isArray(tx?.nativeBalanceChanges)
        ? tx.nativeBalanceChanges
        : [];

    // 1️⃣ Find tracked token received
    const receive = tokenTransfers.find((t) => {
        if (!t) return false;
        if (t.mint !== TRACKED_TOKEN_MINT) return false;
        if (!t.toUserAccount) return false;
        const amt = Number(t.tokenAmount);
        return Number.isFinite(amt) && amt > 0;
    });

    if (!receive) return null;

    const buyer = receive.toUserAccount;

    let solSpent = 0;

    // 2️⃣ Native SOL spent
    const buyerNativeEntry = nativeBalanceChanges.find(
        (x) => x && x.userAccount === buyer
    );

    if (buyerNativeEntry) {
        const change = Number(buyerNativeEntry.nativeBalanceChange);
        if (Number.isFinite(change) && change < 0) {
            solSpent = (-change) / 1e9;
        }
    }

    // 3️⃣ WSOL spent (Raydium / migrated)
    if (solSpent <= 0) {
        const wsolTransfer = tokenTransfers.find(
            (t) =>
                t.mint === WSOL_MINT &&
                t.fromUserAccount === buyer &&
                Number(t.tokenAmount) > 0
        );

        if (wsolTransfer) {
            // Helius enhanced usually gives UI amount already (NOT lamports)
            solSpent = Number(wsolTransfer.tokenAmount);
        }
    }

    if (!(solSpent > 0)) {
        return { skip: true, reason: "no_sol_spent" };
    }

    const signature = tx?.signature || tx?.transactionSignature || null;
    const timestamp = tx?.timestamp || tx?.blockTime || Date.now();

    return {
        type: "BUY",
        wallet: buyer,
        sol: solSpent,
        signature,
        timestamp,
    };
}

// Broadcast function
function broadcast(data) {
    const message = JSON.stringify(data);
    let sent = 0;
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
            sent++;
        }
    });
    return sent;
}

// GET /status endpoint
app.get('/status', (req, res) => {
    res.json({
        ok: true,
        trackedMint: TRACKED_TOKEN_MINT,
        counters: { ...state.counters },
        lastWebhookAt: state.lastWebhookAt,
        lastWebhookSig: state.lastWebhookSig,
        lastParsedBuy: state.lastParsedBuy,
        wsClients: clients.size
    });
});

// POST /helius webhook handler
app.post('/helius', (req, res) => {
    try {
        const webhook = req.body;
        
        // Increment webhook counter and update timestamp
        state.counters.webhooksReceived++;
        state.lastWebhookAt = new Date().toISOString();
        state.lastWebhookSig = webhook.signature || webhook[0]?.signature || null;
        
        // Handle both array and single object
        const transactions = Array.isArray(webhook) ? webhook : [webhook];
        
        let processed = 0;
        let buys = 0;
        let skipped = 0;
        
        // Process each transaction
        for (const tx of transactions) {
            state.counters.txProcessed++;
            processed++;
            
            // Parse buy from transaction
            const result = parseBuyFromHeliusTx(tx);
            
            if (!result) {
                // No buy detected (null returned)
                skipped++;
                continue;
            }
            
            if (result.skip) {
                // Buy detected but skipped (e.g., no_sol_spent)
                state.counters.buysSkipped++;
                skipped++;
                continue;
            }
            
            // Valid BUY detected
            const buyEvent = result;
            
            // Broadcast to WebSocket clients
            broadcast(buyEvent);
            
            // Update state
            state.lastParsedBuy = {
                wallet: buyEvent.wallet,
                sol: buyEvent.sol,
                sig: buyEvent.signature,
                ts: buyEvent.timestamp
            };
            
            state.counters.buysBroadcasted++;
            buys++;
            
            // Log buy
            const walletShort = buyEvent.wallet.length >= 4 ? buyEvent.wallet.slice(-4) : buyEvent.wallet;
            console.log(`BUY wallet=${walletShort} sol=${buyEvent.sol.toFixed(4)} sig=${buyEvent.signature || 'N/A'}`);
        }
        
        // Log webhook summary
        console.log(`webhook ok: txCount=${transactions.length} processed=${processed} buys=${buys} skipped=${skipped}`);
        
        res.status(200).send('OK');
    } catch (error) {
        state.counters.parseErrors++;
        console.error(`parse error: ${error.message}`);
        res.status(200).send('OK');
    }
});

server.listen(3000, () => {
    console.log('Server listening on port 3000');
    console.log('WebSocket server ready on /ws');
    console.log('Status endpoint: GET /status');
});
