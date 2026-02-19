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

app.post('/helius', (req, res) => {
    try {
        const webhook = req.body;
        
        // Process each transaction in the webhook
        if (webhook && Array.isArray(webhook)) {
            webhook.forEach(tx => {
                // Process SWAP transactions only
                if (tx.type === "SWAP") {
                    // Check account data for native balance changes
                    if (tx.accountData && Array.isArray(tx.accountData)) {
                        tx.accountData.forEach(account => {
                            // Buy = nativeBalanceChange is negative (money going out) AND token balance increases
                            const nativeBalanceChange = account.nativeBalanceChange || 0;
                            const tokenBalanceChange = account.tokenBalanceChange || account.tokenBalance || 0;
                            
                            if (nativeBalanceChange < 0 && tokenBalanceChange > 0) {
                                const wallet = account.account || account.userAccount || 'Unknown';
                                const solAmount = Math.abs(nativeBalanceChange) / 1_000_000_000;
                                
                                console.log('BUY:');
                                console.log(`Wallet: ${wallet}`);
                                console.log(`SOL: ${solAmount}`);
                                
                                // Broadcast to all connected WebSocket clients
                                const buyData = {
                                    wallet: wallet,
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


