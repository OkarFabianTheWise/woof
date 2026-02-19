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
const TRACKED_TOKEN_MINT = process.env.TRACKED_MINT || "7K9NBMzAFvk5gfabciSJsZZRt2i7BB6oJdRSkyxsMMX8";
// WSOL mint address
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Flag to log first transaction only
let hasLoggedFirstTransaction = false;

app.post('/helius', (req, res) => {
    try {
        const webhook = req.body;
        
        // Process each transaction in the webhook
        if (webhook && Array.isArray(webhook)) {
            webhook.forEach(tx => {
                // Temporary logging: log full transaction object for first transaction only
                if (!hasLoggedFirstTransaction) {
                    console.log(JSON.stringify(tx, null, 2));
                    hasLoggedFirstTransaction = true;
                }
                
                // Process SWAP transactions only
                if (tx.type === "SWAP") {
                    let buyer = null;
                    let solSpent = 0;

                    const nativeChanges = tx.nativeBalanceChanges || [];
                    const transfers = tx.tokenTransfers || [];

                    for (const change of nativeChanges) {
                        if (change.nativeBalanceChange < 0) {
                            const wallet = change.userAccount;
                            const sol = Math.abs(change.nativeBalanceChange) / 1e9;

                            const received = transfers.find(t =>
                                t.mint === TRACKED_TOKEN_MINT &&
                                t.toUserAccount === wallet
                            );

                            if (received) {
                                buyer = wallet;
                                solSpent = sol;
                                break;
                            }
                        }
                    }

                    if (buyer) {
                        console.log("BUY DETECTED", buyer, solSpent);

                        // Broadcast to all connected WebSocket clients
                        const buyData = {
                            wallet: buyer,
                            sol: solSpent,
                            timestamp: Date.now()
                        };

                        const message = JSON.stringify(buyData);
                        clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(message);
                            }
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


