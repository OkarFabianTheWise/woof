// Timer state
let timeLeft = 10;
let timerInterval = null;
let isRunning = false;
let roundStartTime = 0; // Buys before this are from previous round (excluded from leading)

// PumpFun token configuration
// TODO: Set your PumpFun token address here (Solana token mint address)
// Example: 'So11111111111111111111111111111111111111112' (replace with your token address)
const TOKEN_ADDRESS = 'GnkitxfvNLGGsXKGckU2Bw9uEnzwmVmJKzTaHpp1pump';
let pumpfunWS = null;
let isWSConnected = false;
let currentTokenAddress = TOKEN_ADDRESS;
let isTrackingPaused = false; // Flag to pause/resume tracking

// DOM elements
const timerDisplay = document.getElementById('timerDisplay');
const winnerOverlay = document.getElementById('winnerOverlay');
const newRoundText = document.getElementById('newRoundText');
const particlesContainer = document.getElementById('particles');
const particlesDirection = document.getElementById('particlesDirection');
const particlesFreeze = document.getElementById('particlesFreeze');
const buysList = document.getElementById('recentBuys');
const leadingBuySection = document.getElementById('leadingBuySection');
const leadingBuyDisplay = document.getElementById('leadingBuyDisplay');
const winnersList = document.getElementById('winnersList');
const winnersScrollIndicator = document.getElementById('winnersScrollIndicator');
const infoButton = document.getElementById('infoButton');

// Particle state - JS-driven so we can smoothly reverse direction
let particleData = [];
let particleDirection = 1; // 1 = up, -1 = down
let particleAnimationId = null;

function createParticles() {
    if (!particlesContainer) return;
    const vh = window.innerHeight;
    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle particle-js';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.bottom = '0px';
        particle.style.animation = 'none';
        const y = Math.random() * vh;
        const speed = 0.3 + Math.random() * 0.5;
        particleData.push({ el: particle, y, speed });
        particlesContainer.appendChild(particle);
    }
    animateParticles();
}

function animateParticles() {
    if (!particlesContainer) return;
    const vh = window.innerHeight;
    const isFrozen = particlesContainer.classList.contains('frozen');

    particleData.forEach((p) => {
        if (!isFrozen) {
            p.y += p.speed * particleDirection;
            if (particleDirection > 0 && p.y > vh + 80) p.y = -20;
            if (particleDirection < 0 && p.y < -80) p.y = vh + 20;
        }
        p.el.style.transform = `translateY(${-p.y}px)`;
        const fadeDist = 60;
        let opacity = 1;
        if (p.y < fadeDist) opacity = p.y / fadeDist;
        else if (p.y > vh - fadeDist) opacity = (vh - p.y) / fadeDist;
        p.el.style.opacity = Math.max(0, opacity);
    });

    particleAnimationId = requestAnimationFrame(animateParticles);
}

// Start the countdown timer
function startTimer() {
    // Clear any existing interval first
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    isRunning = true;
    timeLeft = 10;
    updateTimerDisplay();
    
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        
        // Add pulse effect when time is running low
        if (timeLeft <= 5) {
            timerDisplay.style.animation = 'timerPulse 0.3s ease-in-out infinite';
            timerDisplay.style.color = '#14f195';
        }
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            // Store the current round's start time before showing winner (so we can find buys from this round)
            const currentRoundStartTime = roundStartTime;
            // Mark round end - next round's leading must be after this
            roundStartTime = Date.now();
            showWinner(currentRoundStartTime);
        }
    }, 1000);
}

// Update timer display
function updateTimerDisplay() {
    timerDisplay.textContent = timeLeft;
    
    // Add scale animation on each second
    timerDisplay.style.transform = 'scale(1.1)';
    setTimeout(() => {
        timerDisplay.style.transform = 'scale(1)';
    }, 200);
    
    // Show/hide Leading buy section when timer reaches 9 or less
    updateLeadingBuyDisplay();
}

// Typewriter effect function
function typewriterEffect(element, text, speed = 80) {
    // Clear existing text but keep the dots span
    const dotsSpan = element.querySelector('.dots');
    const textNodes = [];
    for (let node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        }
    }
    textNodes.forEach(node => node.remove());
    
    // Ensure dots span exists
    if (!dotsSpan) {
        const span = document.createElement('span');
        span.className = 'dots';
        element.appendChild(span);
    }
    
    element.style.opacity = '1';
    
    let i = 0;
    function type() {
        if (i < text.length) {
            const textNode = document.createTextNode(text.charAt(i));
            const dots = element.querySelector('.dots');
            element.insertBefore(textNode, dots);
            i++;
            setTimeout(type, speed);
        }
    }
    type();
}

// Show winner overlay
function showWinner(roundStartTimeForWinner = roundStartTime) {
    // Get the current jackpot amount as the winning amount
    const jackpotAmount = parseFloat(document.getElementById('jackpotAmount').textContent);
    
    // Find the leading buy (the one that would win - must be >= 0.2 SOL from the round that just ended)
    // This must match the same logic as updateLeadingBuyDisplay() - the LARGEST qualifying buy
    const qualifyingBuys = buyItems.filter((b) => b.amount >= 0.2 && b.createdAt >= roundStartTimeForWinner);
    const leading = qualifyingBuys.length > 0 
        ? qualifyingBuys.sort((a, b) => {
            // Sort by amount descending (largest first), then by createdAt descending (latest/newest first if same amount)
            if (b.amount !== a.amount) {
                return b.amount - a.amount;
            }
            return b.createdAt - a.createdAt; // Newest first when amounts are equal
        })[0]
        : null;
    
    console.log('Finding winner - roundStartTimeForWinner:', roundStartTimeForWinner, 'buyItems:', buyItems.length);
    console.log('Qualifying buys:', qualifyingBuys.length, 'Leading:', leading);
    
    // Use the leading buy's wallet and transaction hash, or fallback if no leading buy
    let winnerWallet = '????';
    let winnerTxHash = null;
    
    if (leading && leading.wallet) {
        // Use the short wallet for display (last 4 chars) - it's already stored as short format
        winnerWallet = leading.wallet;
        winnerTxHash = leading.txHash || null;
        console.log('✅ Using leading buy wallet:', winnerWallet, 'txHash:', winnerTxHash);
    } else {
        // Fallback: find the largest buy from the round (even if < 0.2 SOL)
        const allRoundBuys = buyItems.filter((b) => b.createdAt >= roundStartTimeForWinner);
        const largestBuy = allRoundBuys.length > 0
            ? allRoundBuys.sort((a, b) => b.amount - a.amount)[0]
            : null;
        if (largestBuy && largestBuy.wallet) {
            winnerWallet = largestBuy.wallet;
            winnerTxHash = largestBuy.txHash || null;
            console.log('✅ Using largest buy wallet (fallback):', winnerWallet);
        } else {
            // Last resort: use the most recent qualifying buy (any amount, any time)
            const mostRecentQualifying = buyItems
                .filter((b) => b.amount >= 0.2)
                .sort((a, b) => b.createdAt - a.createdAt)[0];
            if (mostRecentQualifying && mostRecentQualifying.wallet) {
                winnerWallet = mostRecentQualifying.wallet;
                winnerTxHash = mostRecentQualifying.txHash || null;
                console.log('✅ Using most recent qualifying buy wallet (last resort):', winnerWallet);
            } else {
                // Final fallback: most recent buy of any amount
                const mostRecent = buyItems.length > 0 ? buyItems[0] : null;
                if (mostRecent && mostRecent.wallet) {
                    winnerWallet = mostRecent.wallet;
                    winnerTxHash = mostRecent.txHash || null;
                    console.log('✅ Using most recent buy wallet (final fallback):', winnerWallet);
                } else {
                    console.warn('⚠️ No wallet found for winner!');
                }
            }
        }
    }
    
    // Add winner to the winners list with actual transaction hash
    addWinner(jackpotAmount.toFixed(2), winnerWallet, winnerTxHash);
    
    // Display winning amount and wallet in overlay (same wallet as winners list)
    const winnerAmountDisplay = document.getElementById('winnerAmountDisplay');
    const winnerWalletDisplay = document.getElementById('winnerWalletDisplay');
    if (winnerAmountDisplay) winnerAmountDisplay.textContent = jackpotAmount.toFixed(2) + ' SOL';
    if (winnerWalletDisplay) winnerWalletDisplay.textContent = '...' + winnerWallet;
    
    winnerOverlay.classList.add('show');
    newRoundText.textContent = '';
    newRoundText.style.opacity = '0';
    newRoundText.classList.remove('show');
    
    // Show "Processing payout…" initially
    const payoutStatusText = document.getElementById('payoutStatusText');
    if (payoutStatusText) {
        payoutStatusText.textContent = 'Processing payout…';
        payoutStatusText.classList.remove('confirmed');
    }
    
    // After 2.5s, change to "Transaction confirmed!"
    setTimeout(() => {
        if (payoutStatusText) {
            payoutStatusText.textContent = 'Transaction confirmed!';
            payoutStatusText.classList.add('confirmed');
        }
        
        // After "Transaction confirmed!" appears, start "New Round Starting" typewriter (1s later)
        setTimeout(() => {
            newRoundText.classList.add('show');
            typewriterEffect(newRoundText, 'New Round Starting', 60);
        }, 1000);
    }, 2500);
    
    // Start fade out after 7 seconds
    setTimeout(() => {
        winnerOverlay.classList.add('fade-out');
    }, 7000);
    
    // Hide overlay after fade out completes (1.5s fade + buffer)
        // Timer will wait for first buy of 0.2 SOL or more to restart
    setTimeout(() => {
        winnerOverlay.classList.remove('show', 'fade-out');
        newRoundText.textContent = '';
        newRoundText.style.opacity = '0';
        newRoundText.classList.remove('show');
        const winnerAmountDisplay = document.getElementById('winnerAmountDisplay');
        const winnerWalletDisplay = document.getElementById('winnerWalletDisplay');
        const payoutStatusText = document.getElementById('payoutStatusText');
        if (winnerAmountDisplay) winnerAmountDisplay.textContent = '';
        if (winnerWalletDisplay) winnerWalletDisplay.textContent = '';
        if (payoutStatusText) {
            payoutStatusText.textContent = 'Processing payout…';
            payoutStatusText.classList.remove('confirmed');
        }
        isRunning = false;
        timeLeft = 10;
        roundStartTime = Date.now(); // New round - only buys added after this can be leading
        // Reset timer display but don't start counting yet
        timerDisplay.textContent = '10';
        timerDisplay.style.animation = 'timerPulse 1s ease-in-out infinite';
        timerDisplay.style.color = '#14f195';
        leadingBuySection?.classList.remove('visible');
        // Timer will start when first buy of 0.2 SOL or more happens
    }, 8500);
}

// Particles direction - reverse particle movement
if (particlesDirection && particlesContainer) {
    particlesDirection.addEventListener('click', () => {
        particleDirection *= -1;
        particlesContainer.classList.toggle('reversed');
        particlesDirection.classList.toggle('reversed');
    });
}

// Particles freeze - freeze/unfreeze
if (particlesFreeze && particlesContainer) {
    particlesFreeze.addEventListener('click', () => {
        particlesContainer.classList.toggle('frozen');
        particlesFreeze.classList.toggle('frozen');
    });
}

// Live buys functionality
let buyItems = [];
const maxVisibleBuys = 15;

// Winners functionality
let winnerItems = [];
const maxVisibleWinners = 15;

// Generate random transaction hash for solscan link
function generateTxHash() {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
        hash += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return hash;
}

// Add winner to winners list
function addWinner(amount, wallet, txHash = null) {
    const winnerItem = document.createElement('div');
    winnerItem.className = 'winner-item';
    
    const winnerHeader = document.createElement('div');
    winnerHeader.className = 'winner-header';
    
    const winnerAmount = document.createElement('span');
    winnerAmount.className = 'winner-amount';
    winnerAmount.textContent = `${amount} SOL`;
    
    const winnerWallet = document.createElement('span');
    winnerWallet.className = 'winner-wallet';
    winnerWallet.textContent = `...${wallet}`;
    
    winnerHeader.appendChild(winnerAmount);
    winnerHeader.appendChild(winnerWallet);
    
    // Use actual transaction hash if available, otherwise generate one
    const actualTxHash = txHash || generateTxHash();
    const winnerTx = document.createElement('a');
    winnerTx.className = 'winner-tx';
    winnerTx.href = `https://solscan.io/tx/${actualTxHash}`;
    winnerTx.target = '_blank';
    winnerTx.rel = 'noopener noreferrer';
    winnerTx.textContent = `TX: ${actualTxHash.slice(0, 8)}...${actualTxHash.slice(-4)}`;
    
    winnerItem.appendChild(winnerHeader);
    winnerItem.appendChild(winnerTx);
    
    const winnerData = { element: winnerItem, createdAt: Date.now() };
    winnerItems.unshift(winnerData); // Add new winner to beginning
    
    // Insert at the top
    if (winnersList.firstChild) {
        winnersList.insertBefore(winnerItem, winnersList.firstChild);
    } else {
        winnersList.appendChild(winnerItem);
    }
    
    // All winners stay visible - scroll to see older ones beyond the viewport
    updateWinnersScrollIndicator();
}

function updateWinnersScrollIndicator() {
    if (!winnersScrollIndicator || !winnersList) return;
    const isScrollable = winnersList.scrollHeight > winnersList.clientHeight;
    const isAtTop = winnersList.scrollTop <= 2;
    const isAtBottom = winnersList.scrollTop + winnersList.clientHeight >= winnersList.scrollHeight - 2;
    winnersScrollIndicator.classList.toggle('visible', isScrollable);
    winnersScrollIndicator.classList.toggle('can-scroll-up', isScrollable && !isAtTop);
    winnersScrollIndicator.classList.toggle('can-scroll-down', isScrollable && !isAtBottom);
    // Mask fade: top only when scrolled, bottom when more content below
    winnersList.style.setProperty('--fade-top', isScrollable && !isAtTop ? '12%' : '0%');
    winnersList.style.setProperty('--fade-bottom', isScrollable && !isAtBottom ? '88%' : '100%');
}

function formatTimestamp(secondsAgo) {
    if (secondsAgo < 60) {
        return `${secondsAgo}s ago`;
    } else {
        const minutes = Math.floor(secondsAgo / 60);
        return `${minutes}m ago`;
    }
}

function createBuyItem(amount, wallet, timestamp) {
    const buyItem = document.createElement('div');
    const buyAmountValue = parseFloat(amount);
    
    // Add greyed-out class for buys under 0.2 SOL
    if (buyAmountValue < 0.2) {
        buyItem.className = 'buy-item buy-item-greyed';
    } else {
        buyItem.className = 'buy-item';
    }
    
    const buyHeader = document.createElement('div');
    buyHeader.className = 'buy-header';
    
    const buyAmount = document.createElement('span');
    buyAmount.className = 'buy-amount';
    buyAmount.textContent = `${amount} SOL`;
    
    const buyWallet = document.createElement('span');
    buyWallet.className = 'buy-wallet';
    buyWallet.textContent = `...${wallet}`;
    
    buyHeader.appendChild(buyAmount);
    buyHeader.appendChild(buyWallet);
    
    const buyTimestamp = document.createElement('div');
    buyTimestamp.className = 'buy-timestamp';
    buyTimestamp.textContent = formatTimestamp(timestamp);
    
    buyItem.appendChild(buyHeader);
    buyItem.appendChild(buyTimestamp);
    
    return buyItem;
}

function updateLeadingBuyDisplay() {
    if (!leadingBuySection || !leadingBuyDisplay) return;
    
    // Only show when timer is 9 or less (countdown has started)
    const shouldShow = timeLeft <= 9 && !winnerOverlay.classList.contains('show');
    // Leading buy must be from current round (added after roundStartTime)
    // Find the LARGEST qualifying buy (>= 0.2 SOL) from current round
    const qualifyingBuys = buyItems.filter((b) => b.amount >= 0.2 && b.createdAt >= roundStartTime);
    const leading = qualifyingBuys.length > 0
        ? qualifyingBuys.sort((a, b) => {
            // Sort by amount descending (largest first), then by createdAt descending (latest/newest first if same amount)
            if (b.amount !== a.amount) {
                return b.amount - a.amount;
            }
            return b.createdAt - a.createdAt; // Newest first when amounts are equal
        })[0]
        : null;
    
    if (shouldShow && leading) {
        leadingBuySection.classList.add('visible');
        const elapsed = Math.floor((Date.now() - leading.createdAt) / 1000);
        leadingBuyDisplay.innerHTML = `
            <div class="leading-buy-amount">${leading.amount.toFixed(2)} SOL</div>
            <div class="leading-buy-wallet">...${leading.wallet || '????'}</div>
            <div class="leading-buy-timestamp">${formatTimestamp(elapsed)}</div>
        `;
    } else {
        leadingBuySection.classList.remove('visible');
    }
}

function addBuy(amount, wallet, timestamp, txHash = null, fullWallet = null) {
    const buyItem = createBuyItem(amount, wallet, timestamp);
    const amountNum = parseFloat(amount);
    // Store both short wallet (for display) and full wallet (for winner display and transaction links)
    const buyData = { element: buyItem, timestamp: timestamp, createdAt: Date.now(), amount: amountNum, wallet, txHash, fullWallet: fullWallet || wallet };
    
    // If list is at max capacity, remove the oldest item FIRST (synchronously)
    // This keeps the list height constant and prevents hopping
    if (buyItems.length >= maxVisibleBuys) {
        const oldItem = buyItems[buyItems.length - 1];
        if (oldItem && oldItem.element && oldItem.element.parentNode) {
            // Remove immediately to keep height constant
            oldItem.element.remove();
            // Remove from array
            buyItems.pop();
        }
    }
    
    // Add to beginning of array (newest first)
    buyItems.unshift(buyData);
    
    // Insert new buy at the top position
    if (buysList.firstChild) {
        buysList.insertBefore(buyItem, buysList.firstChild);
    } else {
        buysList.appendChild(buyItem);
    }
    
    // Update leading buy display when timer <= 9
    updateLeadingBuyDisplay();
    
    // Restart timer if buy is 0.2 SOL or bigger (but not during winner display)
    if (parseFloat(amount) >= 0.2 && !winnerOverlay.classList.contains('show')) {
        // Clear any existing interval
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        isRunning = false;
        // Reset timer effects
        timerDisplay.style.animation = 'timerPulse 1s ease-in-out infinite';
        timerDisplay.style.color = '#14f195';
        startTimer();
    }
}

function updateTimestamps() {
    // Update timestamps and remove old items
    buyItems = buyItems.filter((buy) => {
        const elapsed = Math.floor((Date.now() - buy.createdAt) / 1000);
        const timestampEl = buy.element.querySelector('.buy-timestamp');
        if (timestampEl) {
            timestampEl.textContent = formatTimestamp(elapsed);
        }
        
        // Fade out items that are too old (more than 5 minutes)
        if (elapsed > 300 && !buy.element.classList.contains('fade-out')) {
            buy.element.classList.add('fade-out');
            setTimeout(() => {
                if (buy.element.parentNode) {
                    buy.element.remove();
                }
            }, 500);
            return false; // Remove from array
        }
        
        return true; // Keep in array
    });
    updateLeadingBuyDisplay();
}

// Pause WebSocket tracking
function pauseTracking() {
    isTrackingPaused = true;
    console.log('⏸️ Pausing WebSocket tracking...');
    if (pumpfunWS && isWSConnected) {
        pumpfunWS.close();
        pumpfunWS = null;
        isWSConnected = false;
    }
}

// Call pauseTracking to pause tracking now
pauseTracking();

// Resume WebSocket tracking
function resumeTracking() {
    isTrackingPaused = false;
    if (!isWSConnected && TOKEN_ADDRESS) {
        console.log('▶️ Resuming WebSocket tracking...');
        connectPumpFunWebSocket();
    }
}

// WebSocket connection to PumpPortal
function connectPumpFunWebSocket() {
    if (!TOKEN_ADDRESS) {
        console.error('Token address not set. Please set TOKEN_ADDRESS in script.js');
        return;
    }
    
    if (isTrackingPaused) {
        console.log('⏸️ Tracking is paused. Not connecting.');
        return;
    }

    const wsUrl = 'wss://pumpportal.fun/api/data';
    
    try {
        pumpfunWS = new WebSocket(wsUrl);
        
        pumpfunWS.onopen = () => {
            console.log('✅ Connected to PumpPortal WebSocket');
            isWSConnected = true;
            currentTokenAddress = TOKEN_ADDRESS;
            
            // Subscribe to token trades - requires 'keys' parameter as array of strings
            const subscribeMsg = {
                method: 'subscribeTokenTrade',
                keys: [TOKEN_ADDRESS]
            };
            console.log('📤 Sending subscription:', subscribeMsg);
            pumpfunWS.send(JSON.stringify(subscribeMsg));
            
            // Subscribe to migration events
            pumpfunWS.send(JSON.stringify({
                method: 'subscribeMigration',
                keys: [TOKEN_ADDRESS]
            }));
            
            console.log('✅ Subscribed to token:', TOKEN_ADDRESS);
        };
        
        pumpfunWS.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data);
                handlePumpFunData(data);
            } catch (err) {
                console.error('Error parsing WebSocket data:', err, event.data);
            }
        };
        
        pumpfunWS.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            console.error('Error details:', error.message || error);
            isWSConnected = false;
        };
        
        pumpfunWS.onclose = (event) => {
            console.log('⚠️ WebSocket closed. Code:', event.code, 'Reason:', event.reason);
            isWSConnected = false;
            // Reconnect after 3 seconds only if not paused
            if (!isTrackingPaused) {
                setTimeout(() => {
                    console.log('🔄 Attempting to reconnect...');
                    connectPumpFunWebSocket();
                }, 3000);
            }
        };
    } catch (error) {
        console.error('Failed to connect to WebSocket:', error);
        // Retry connection after 3 seconds only if not paused
        if (!isTrackingPaused) {
            setTimeout(connectPumpFunWebSocket, 3000);
        }
    }
}

// Handle incoming PumpFun data
function handlePumpFunData(data) {
    // Skip if tracking is paused
    if (isTrackingPaused) {
        return;
    }
    
    // Skip error messages and subscription confirmations
    if (data.errors || data.message) {
        return;
    }
    
    // PumpPortal sends trade data directly with signature, mint, traderPublicKey, txType, solAmount
    // Check if this looks like a trade object
    if (data.signature && data.mint && data.traderPublicKey && data.txType) {
        console.log('Processing trade data:', data);
        
        // Extract trade information from PumpPortal format
        const solAmount = data.solAmount || 0;
        const wallet = data.traderPublicKey || '';
        const txHash = data.signature || '';
        const isBuy = data.txType === 'buy';
        
        console.log('Extracted values:', { solAmount, wallet, txHash, isBuy });
        
        // Only process buy transactions
        if (isBuy && solAmount > 0 && wallet) {
            // solAmount is already in SOL (not lamports) from PumpPortal
            const solAmountFormatted = parseFloat(solAmount).toFixed(2);
            
            // Extract last 4 characters of wallet for display
            const walletShort = wallet.length >= 4 ? wallet.slice(-4).toUpperCase() : wallet.toUpperCase();
            
            console.log('✅ Adding buy:', solAmountFormatted, 'SOL from', walletShort);
            
            // Add buy with real-time data (pass short wallet for display, full wallet and txHash for storage)
            addBuy(solAmountFormatted, walletShort, 0, txHash, wallet);
        } else {
            console.log('⏭️ Skipping trade - not a buy or missing data:', { isBuy, solAmount, wallet });
        }
    } else {
        // Try alternative data structures (fallback)
        const trade = data.params || data.data || data.result || data.trade || data.transaction || data;
        
        if (trade && (trade.signature || trade.tx || trade.transaction)) {
            console.log('Processing alternative trade format:', trade);
            
            let solAmount = trade.solAmount || trade.sol_amount || trade.amount || trade.amountIn || 
                           trade.quoteAmount || trade.nativeAmount || trade.native_amount || 
                           trade.sol || trade.solValue || 0;
            let wallet = trade.traderPublicKey || trade.user || trade.account || trade.buyer || 
                        trade.trader || trade.wallet || trade.userWallet || trade.owner || 
                        trade.signer || trade.publicKey || '';
            const txHash = trade.signature || trade.tx || trade.transaction || trade.txHash || '';
            const isBuy = trade.txType === 'buy' || (trade.isBuy !== false && trade.side !== 'sell' && trade.type !== 'sell');
            
            if (isBuy && solAmount > 0 && wallet) {
                let solAmountFormatted;
                if (solAmount > 1e6) {
                    solAmountFormatted = (solAmount / 1e9).toFixed(2);
                } else {
                    solAmountFormatted = parseFloat(solAmount).toFixed(2);
                }
                
                const walletShort = wallet.length >= 4 ? wallet.slice(-4).toUpperCase() : wallet.toUpperCase();
                
                console.log('✅ Adding buy (alternative format):', solAmountFormatted, walletShort);
                addBuy(solAmountFormatted, walletShort, 0, txHash, wallet);
            }
        }
    }
    
    // Handle migration events
    if (data.type === 'migration' || data.method === 'migration' || data.event === 'migration' ||
        (data.data && data.data.type === 'migration')) {
        
        const migration = data.params || data.data || data;
        const newTokenAddress = migration.newToken || migration.new_token || migration.token || migration.tokenAddress || TOKEN_ADDRESS;
        
        console.log('Token migrated. New address:', newTokenAddress);
        
        // Resubscribe to the new token if address changed
        if (newTokenAddress && newTokenAddress !== currentTokenAddress && isWSConnected && pumpfunWS) {
            // Unsubscribe from old token
            if (currentTokenAddress) {
                pumpfunWS.send(JSON.stringify({
                    method: 'unsubscribeTokenTrade',
                    params: [currentTokenAddress]
                }));
            }
            
            // Update current token address
            currentTokenAddress = newTokenAddress;
            
            // Subscribe to new token
            pumpfunWS.send(JSON.stringify({
                method: 'subscribeTokenTrade',
                params: [newTokenAddress]
            }));
            
            console.log('Resubscribed to new token after migration:', newTokenAddress);
        }
    }
}

// Initialize buys list - only live data from WebSocket
function initBuysList() {
    // Connect to PumpFun WebSocket for live data (only if not paused)
    if (!isTrackingPaused) {
        connectPumpFunWebSocket();
    }
    
    // Update timestamps every second
    setInterval(updateTimestamps, 1000);
}

// Initialize
createParticles();
// Timer will start when first buy of 0.2 SOL or more happens
initBuysList();

// Cleanup WebSockets on page unload
window.addEventListener('beforeunload', () => {
    if (pumpfunWS && isWSConnected) {
        pumpfunWS.close();
    }
});

// Winners list scroll indicator
if (winnersList) {
    winnersList.addEventListener('scroll', updateWinnersScrollIndicator);
}

// Info modal
const infoModalOverlay = document.getElementById('infoModalOverlay');
const infoModalClose = document.getElementById('infoModalClose');
const infoModalContent = document.getElementById('infoModalContent');
const infoModalScrollIndicator = document.getElementById('infoModalScrollIndicator');

function updateInfoModalScrollIndicator() {
    if (!infoModalContent) return;
    const isScrollable = infoModalContent.scrollHeight > infoModalContent.clientHeight;
    const isAtTop = infoModalContent.scrollTop <= 2;
    const isAtBottom = infoModalContent.scrollTop + infoModalContent.clientHeight >= infoModalContent.scrollHeight - 2;
    document.querySelectorAll('.info-modal-scroll-indicator').forEach(el => {
        el.classList.toggle('visible', isScrollable);
        el.classList.toggle('can-scroll-up', isScrollable && !isAtTop);
        el.classList.toggle('can-scroll-down', isScrollable && !isAtBottom);
    });
    infoModalContent.style.setProperty('--info-fade-top', isScrollable && !isAtTop ? '12%' : '0%');
    infoModalContent.style.setProperty('--info-fade-bottom', isScrollable && !isAtBottom ? '88%' : '100%');
}

function openInfoModal() {
    if (infoModalOverlay) infoModalOverlay.classList.add('show');
    setTimeout(updateInfoModalScrollIndicator, 50);
}

function closeInfoModal() {
    if (infoModalOverlay) infoModalOverlay.classList.remove('show');
}

if (infoButton) {
    infoButton.addEventListener('click', openInfoModal);
}

if (infoModalClose) {
    infoModalClose.addEventListener('click', closeInfoModal);
}

if (infoModalOverlay) {
    infoModalOverlay.addEventListener('click', (e) => {
        if (e.target === infoModalOverlay) closeInfoModal();
    });
}

if (infoModalContent) {
    infoModalContent.addEventListener('scroll', updateInfoModalScrollIndicator);
}

window.addEventListener('resize', () => {
    if (infoModalOverlay?.classList.contains('show')) {
        updateInfoModalScrollIndicator();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infoModalOverlay?.classList.contains('show')) {
        closeInfoModal();
    }
});

async function loadBuys() {
  try {
    const res = await fetch("/buys");
    const data = await res.json();
    renderBuys(data);
  } catch (e) {
    console.log("Fetch error", e);
  }
}

function renderBuys(data) {
  const container = document.querySelector("#recentBuys");
  if (!container) return;

  container.innerHTML = "";

  data.forEach(buy => {
    const div = document.createElement("div");
    div.innerHTML = `
      <div>
        <b>${Number(buy.sol).toFixed(2)} SOL</b> — ${(buy.wallet || "").slice(0, 4)}...${(buy.wallet || "").slice(-4)}
      </div>
    `;
    container.appendChild(div);
  });
}

setInterval(loadBuys, 1000);
loadBuys();
