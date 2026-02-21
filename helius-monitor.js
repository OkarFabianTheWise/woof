const WebSocket = require("ws");

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TOKEN_MINT = process.env.TOKEN_MINT || "HACLKPh6WQ79gP9NuufSs9VkDUjVsk5wCdbBCjTLpump";

function startHeliusMonitor(options) {
  const { apiKey, tokenMint, onBuy } = options || {};
  const key = apiKey || HELIUS_API_KEY;
  const mint = tokenMint || TOKEN_MINT;
  if (!key) {
    console.error("helius-monitor: HELIUS_API_KEY required");
    return;
  }
  const ws = new WebSocket(`wss://mainnet.helius-rpc.com/?api-key=${key}`);

  function subscribeToTokenBuys() {
    const request = {
        jsonrpc: "2.0",
        id: 420,
        method: "transactionSubscribe",
        params: [
            {
                failed: false,
                vote: false,
                accountInclude: [
                    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token Program
                    "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium V4
                    "CAMMCzo5YL8w4VFF8KVHrK22GGUQpMpTFb6xRmpLFGNnSm", // Raydium CLMM
                    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter
                    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // Raydium V4 (alternative)
                    "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"  // Magic Eden (for NFT trades)
                ]
            },
            {
                commitment: "confirmed",
                encoding: "jsonParsed",
                transactionDetails: "full",
                maxSupportedTransactionVersion: 0
            }
        ]
    };
    ws.send(JSON.stringify(request));
  }

  function startPing() {
    return setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);
  }

  function parseTokenBuy(transaction, tokenMint) {
    try {
        const { meta, transaction: txData } = transaction;
        
        if (!meta || !txData) return null;

        // Get token balance changes
        const preTokenBalances = meta.preTokenBalances || [];
        const postTokenBalances = meta.postTokenBalances || [];
        
        // Find SOL balance changes (lamports)
        const preBalances = meta.preBalances || [];
        const postBalances = meta.postBalances || [];
        
        let solAmount = 0;
        let tokenAmount = 0;
        let buyer = null;
        let isBuy = false;

        // Analyze balance changes to detect buys
        for (let i = 0; i < preBalances.length; i++) {
            const solChange = (postBalances[i] || 0) - (preBalances[i] || 0);
            
            // If SOL decreased significantly, this might be a buyer
            if (solChange < -1000000) { // More than 0.001 SOL spent
                solAmount = Math.abs(solChange) / 1e9; // Convert lamports to SOL
                buyer = txData.message?.accountKeys?.[i];
                isBuy = true;
                break;
            }
        }

        // Find token amount received
        for (let i = 0; i < postTokenBalances.length; i++) {
            const postBalance = postTokenBalances[i];
            const preBalance = preTokenBalances.find(pre => 
                pre.accountIndex === postBalance.accountIndex
            );
            
            if (postBalance.mint === tokenMint) {
                const tokenChange = postBalance.uiTokenAmount.uiAmount - 
                    (preBalance?.uiTokenAmount?.uiAmount || 0);
                
                if (tokenChange > 0) {
                    tokenAmount = tokenChange;
                    isBuy = true;
                }
            }
        }

        if (isBuy && buyer && solAmount > 0) {
            return {
                signature: txData.signatures?.[0],
                buyer,
                solAmount,
                tokenAmount,
                timestamp: Date.now(),
                slot: transaction.slot
            };
        }

        return null;
    } catch (error) {
        console.error('Error parsing transaction:', error);
        return null;
    }
}

  ws.on("open", () => {
    console.log("Helius monitor WebSocket connected");
    subscribeToTokenBuys();
    startPing();
  });

  ws.on("message", (data) => {
    try {
      const messageObj = JSON.parse(data.toString("utf8"));
      if (messageObj.result !== undefined) return;
      if (messageObj.method === "transactionNotification") {
        const transaction = messageObj.params?.result;
        if (!transaction) return;
        const buyData = parseTokenBuy(transaction, mint);
        if (buyData && typeof onBuy === "function") {
          onBuy(buyData);
        }
      }
    } catch (err) {
      console.error("helius-monitor message error:", err?.message || err);
    }
  });

  ws.on("error", (err) => console.error("helius-monitor WS error:", err?.message || err));

  ws.on("close", () => {
    console.log("Helius monitor closed, reconnecting in 5s");
    setTimeout(() => startHeliusMonitor(options), 5000);
  });

  return ws;
}

module.exports = { startHeliusMonitor, TOKEN_MINT };