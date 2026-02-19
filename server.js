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
const TRACKED_MINT = process.env.TRACKED_MINT || 'GnkitxfvNLGGsXKGckU2Bw9uEnzwmVmJKzTaHpp1pump';
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
                    const transfers = tx.tokenTransfers || [];
                    
                    let buyer = null;
                    let solAmount = 0;
                    
                    for (const t of transfers) {
                        // Detect buyer (receiving tracked token)
                        if (
                            t.mint === TRACKED_MINT &&
                            t.toUserAccount
                        ) {
                            buyer = t.toUserAccount;
                        }
                        
                        // Sum ALL WSOL transfers
                        if (
                            t.mint === WSOL_MINT
                        ) {
                            solAmount += Number(t.tokenAmount || 0);
                        }
                    }
                    
                    // Convert from lamports to SOL
                    solAmount = solAmount / 1_000_000_000;
                    
                    if (buyer && solAmount > 0) {
                        console.log("BUY DETECTED", buyer, solAmount);
                        
                        // Broadcast to all connected WebSocket clients
                        const buyData = {
                            wallet: buyer,
                            sol: solAmount,
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


