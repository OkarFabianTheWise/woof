const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('WebSocket client connected. Total clients:', clients.size);
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('WebSocket client disconnected. Total clients:', clients.size);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

app.use(express.json());

// Tracked token mint address
const TRACKED_TOKEN_MINT = process.env.TRACKED_MINT || "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";
// WSOL mint address
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Broadcast function
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

app.post('/helius', (req, res) => {
    try {
        const webhook = req.body;
        
        // Process each transaction in the webhook
        if (webhook && Array.isArray(webhook)) {
            webhook.forEach(transaction => {
                // Process SWAP transactions only
                if (transaction.type === "SWAP") {
                    let buyer = null;
                    let solSpent = 0;

                    const transfers = transaction.tokenTransfers || [];
                    const nativeChanges = transaction.nativeBalanceChanges || [];

                    // detect buyer (who received tracked token)
                    for (const t of transfers) {
                        if (t.mint === TRACKED_TOKEN_MINT && t.toUserAccount) {
                            buyer = t.toUserAccount;
                            break;
                        }
                    }

                    // detect SOL spent by that buyer
                    if (buyer) {
                        const change = nativeChanges.find(n => n.userAccount === buyer);

                        if (change && change.nativeBalanceChange < 0) {
                            solSpent = Math.abs(change.nativeBalanceChange) / 1e9;
                        }
                    }

                    if (buyer && solSpent > 0) {
                        console.log("BUY DETECTED", buyer, solSpent);

                        broadcast({
                            wallet: buyer,
                            sol: solSpent,
                            timestamp: Date.now()
                        });
                    }
                }
            });
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(200).send('OK');
    }
});

server.listen(3000, () => {
    console.log('Server listening on port 3000');
    console.log('WebSocket server ready');
});

