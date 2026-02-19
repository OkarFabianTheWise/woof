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
                    if (tx.tokenTransfers && Array.isArray(tx.tokenTransfers)) {
                        // A) Find transfer where mint equals tracked token mint and toUserAccount exists
                        const targetTokenTransfer = tx.tokenTransfers.find(transfer => 
                            transfer.mint === TRACKED_MINT &&
                            transfer.toUserAccount
                        );
                        
                        // B) Find transfer where mint === WSOL
                        const wsolTransfer = tx.tokenTransfers.find(transfer => 
                            transfer.mint === WSOL_MINT
                        );
                        
                        // Only treat as BUY if BOTH transfers exist
                        if (targetTokenTransfer && wsolTransfer) {
                            const buyer = targetTokenTransfer.toUserAccount;
                            // Convert tokenAmount from lamports to SOL
                            const solAmount = wsolTransfer.tokenAmount / 1_000_000_000;
                            
                            // Debug log
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


