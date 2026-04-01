// Connect to the backend server
const socket = io();

// Local copy of the state
let gameState = null;
let currentRoomId = null;
let amIHost = false;
let previousPhase = null;

// --- SOUND EFFECTS ---
const sfx = {
    start: new Audio('start.mp3'),
    move: new Audio('move.mp3'),
    flip: new Audio('flip.mp3'),
    win: new Audio('win.mp3'),
    champion: new Audio('champion.mp3'),
    lose: new Audio('lose.mp3'),
    gameover: new Audio('gameover.mp3'),
    tick: new Audio('tick.mp3') // <-- ADDED THE TICKING CLOCK
};

function playSfx(soundName) {
    // Resets the sound to the beginning if it's already playing, then plays it
    if (sfx[soundName]) {
        sfx[soundName].currentTime = 0;
        sfx[soundName].play().catch(() => {}); // Catch prevents errors if browser blocks autoplay
    }
}

// --- DOM ELEMENTS ---
const UI = {
    status: document.getElementById('status-message'),
    gameTable: document.getElementById('game-table'),
    controls: document.getElementById('action-controls'),
    lobbyArea: document.getElementById('lobby-area'),
    playArea: document.getElementById('play-area'),
    playerNameInput: document.getElementById('player-name-input'),
    hostBtn: document.getElementById('host-btn'),
    joinBtn: document.getElementById('join-btn'),
    setupControls: document.getElementById('setup-controls'),
    roomInfo: document.getElementById('room-info'),
    roomCodeDisplay: document.getElementById('room-code-display'),
    lobbyPlayerList: document.getElementById('lobby-player-list'),
        startGameBtn: document.getElementById('start-game-btn'),
        rulesBtn: document.getElementById('rules-btn'),
        rulesModal: document.getElementById('rules-modal'),
        closeRulesBtn: document.getElementById('close-rules-btn'),
        modal: document.getElementById('pass-modal'),
    declareInput: document.getElementById('declare-input'), 
    targetSelect: document.getElementById('target-select'),
    submitPassBtn: document.getElementById('submit-pass-btn'),
    cancelPassBtn: document.getElementById('cancel-pass-btn'),
    chatContainer: document.getElementById('chat-container'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    chatSendBtn: document.getElementById('chat-send-btn'),
    gameOverOverlay: document.getElementById('game-over-overlay'),
    hudArea: document.getElementById('game-info-hud'),
    roundDisplay: document.getElementById('round-display'),
    leaderboardArea: document.getElementById('desktop-leaderboard'),
    leaderboardList: document.getElementById('leaderboard-list')
};

// Check if a friend sent us a link with a room code!
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
        currentRoomId = roomFromUrl;
        UI.hostBtn.style.display = 'none'; // Hide host button if joining a specific room
        UI.joinBtn.innerText = `Join Room ${roomFromUrl}`;
        UI.status.innerText = `Ready to join room ${roomFromUrl}`;
    } else {
        UI.status.innerText = "Welcome to Gaslight Express!";
    }
};

// --- LISTEN FOR SERVER UPDATES ---
socket.on('stateUpdate', (newState) => {
    gameState = newState;
    amIHost = (gameState.hostId === socket.id);
    
    // Check phase transitions for sound effects
    if (previousPhase !== gameState.phase) {
        if (previousPhase === 'LOBBY' && gameState.phase === 'ANNOUNCE') playSfx('start');
        if (previousPhase === 'DRAW' && gameState.phase === 'DRAW_REVEAL') playSfx('flip');
        if (previousPhase === 'HOLDING' && gameState.phase === 'RESPOND') playSfx('tick'); // Swapped 'move' for 'tick' to build tension!
        if (previousPhase === 'RESPOND' && gameState.phase === 'HOLDING') playSfx('move');
        if (gameState.phase === 'GAME_OVER') playSfx('gameover');
        
        // If the phase changes AWAY from RESPOND, immediately kill the ticking track
        if (previousPhase === 'RESPOND' && sfx.tick) {
            sfx.tick.pause();
            sfx.tick.currentTime = 0;
        }
        
        previousPhase = gameState.phase;
    }
    
    render();
});

socket.on('challengeResult', (data) => {
    playSfx('lose'); // Everyone hears the sad sound when someone gets a card
});

socket.on('roundOver', () => {
    playSfx('lose'); // End of a round is still a penalty moment
});

socket.on('finalGameOver', (data) => {
    // Check if the current player is in the list of winners (lowest score)
    if (data.winnerIds.includes(socket.id)) {
        playSfx('champion'); // <-- CHANGED 'win' to 'champion'
    } else {
        playSfx('gameover');
    }
});

socket.on('roomCreated', (roomId) => {
    currentRoomId = roomId;
    window.history.pushState({}, '', `?room=${roomId}`);
    UI.setupControls.classList.add('hidden');
    UI.roomInfo.classList.remove('hidden');
    UI.roomCodeDisplay.innerText = `Room Code: ${roomId}`;
    UI.chatContainer.classList.remove('hidden'); // Reveal chat when hosting
});

socket.on('joinedRoom', (roomId) => {
    currentRoomId = roomId;
    window.history.pushState({}, '', `?room=${roomId}`);
    UI.setupControls.classList.add('hidden');
    UI.roomInfo.classList.remove('hidden');
    UI.roomCodeDisplay.innerText = `Room Code: ${roomId}`;
    UI.chatContainer.classList.remove('hidden'); // Reveal chat when joining
});

socket.on('errorMsg', (msg) => {
    alert(msg);
});

// --- RENDER LOGIC ---
function renderLobby() {
    UI.lobbyPlayerList.innerHTML = '';
    gameState.players.forEach(p => {
        const pDiv = document.createElement('div');
        pDiv.innerText = `👤 ${p.name}`;
        UI.lobbyPlayerList.appendChild(pDiv);
    });

    // Only the host gets to click the Start Game button
    if (amIHost && gameState.players.length >= 2) {
        UI.startGameBtn.classList.remove('hidden');
    } else if (!amIHost && gameState.players.length >= 2) {
        UI.status.innerText = "Waiting for host to start the game...";
        UI.startGameBtn.classList.add('hidden');
    } else {
        UI.status.innerText = "Waiting for more players to join...";
        UI.startGameBtn.classList.add('hidden');
    }
}

function render() {
    if (!gameState) return;

    if (gameState.phase === 'LOBBY') {
        UI.lobbyArea.classList.remove('hidden');
        UI.playArea.classList.add('hidden');
        document.body.classList.remove('in-game');
        UI.gameOverOverlay.classList.add('hidden'); 
        UI.hudArea.classList.add('hidden');
        UI.leaderboardArea.classList.add('hidden');
        renderLobby();
        return; 
    } else {
        UI.lobbyArea.classList.add('hidden');
        UI.playArea.classList.remove('hidden');
        document.body.classList.add('in-game');
        UI.hudArea.classList.remove('hidden');
        UI.leaderboardArea.classList.remove('hidden');
    }

    // Update Round Counter & Leaderboard
    UI.roundDisplay.innerText = `Round ${gameState.currentRound} / ${gameState.maxRounds}`;
    UI.leaderboardList.innerHTML = '';
    gameState.players.forEach(p => {
        const entry = document.createElement('div');
        entry.className = 'leaderboard-entry';
        const streakText = p.winStreak > 0 ? ` <span style="color: #ff9f43; font-weight: bold;">🔥x${p.winStreak}</span>` : '';
        entry.innerHTML = `<strong>${p.name}${streakText}</strong><br>Cards: ${p.penalties} | <span class="score">Score: ${p.totalScore}</span>`;
        UI.leaderboardList.appendChild(entry);
    });

    renderPlayers();
    UI.controls.innerHTML = ''; 
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    // Ensure buttons only appear if it is ACTUALLY the player's turn 
    // (so player 2 can't click player 1's buttons)
    const isMyTurn = (currentPlayer && currentPlayer.socketId === socket.id);
    const amITarget = (gameState.targetPlayerIndex !== null && gameState.players[gameState.targetPlayerIndex].socketId === socket.id);

    switch(gameState.phase) {
        case 'ANNOUNCE':
            const me = gameState.players.find(p => p.socketId === socket.id);
            if (me && !me.isReady) {
                UI.status.innerText = `Memorize everyone's starting cards!`;
                const readyBtn = document.createElement('button');
                readyBtn.innerText = "I'm Ready!";
                readyBtn.onclick = () => socket.emit('playerReady');
                UI.controls.appendChild(readyBtn);
            } else {
                UI.status.innerText = `Waiting for other players to ready up...`;
            }
            break;

        case 'DRAW':
            UI.status.innerText = `${currentPlayer.name}'s turn. Click the center deck to draw.`;
            UI.card.className = 'card hidden' + (isMyTurn ? ' clickable' : ''); 
            
            const deckDir = gameState.itemDirections[gameState.deck[0]];
            UI.card.innerHTML = `<img src="${deckDir}.png" class="card-back-icon" alt="${deckDir}">`;
            
            if (isMyTurn) UI.card.onclick = () => socket.emit('drawCard'); 
            else UI.card.onclick = null;
            break;

        case 'DRAW_REVEAL':
            UI.status.innerText = `Revealing ${currentPlayer.name}'s drawn card to everyone...`;
            UI.card.style.display = 'flex';
            UI.card.className = 'card';
            UI.card.innerHTML = `<img src="${gameState.drawnCardReveal.item}.png" alt="${gameState.drawnCardReveal.item}">`;
            UI.card.onclick = null;
            break;

        case 'HOLDING':
            UI.status.innerText = isMyTurn ? `Your turn! Click your OLD card to pass it.` : `Waiting for ${currentPlayer.name} to pass...`;
            UI.card.style.display = 'none'; 
            break;

        case 'RESPOND':
            UI.card.style.display = 'flex'; 
            UI.card.className = 'card hidden';
            UI.card.innerHTML = `<img src="${gameState.transitCard.direction}.png" class="card-back-icon" alt="${gameState.transitCard.direction}">`;
            
            const targetPlayer = gameState.players[gameState.targetPlayerIndex];
            UI.status.innerText = `${currentPlayer.name} passed a "${gameState.declaredItem}" to ${targetPlayer.name}.`;
            
            if (amITarget) {
                const acceptBtn = document.createElement('button');
                acceptBtn.innerText = "Accept";
                acceptBtn.onclick = () => socket.emit('acceptCard');

                const challengeBtn = document.createElement('button');
                challengeBtn.className = "danger";
                challengeBtn.innerText = "Challenge!";
                challengeBtn.onclick = () => socket.emit('challengeCard');

                UI.controls.append(acceptBtn, challengeBtn);
            }
            break;

        case 'REVEAL':
            UI.card.className = 'card';
            UI.card.innerHTML = `<img src="${gameState.actualItem}.png" alt="${gameState.actualItem}">`;
            
            if (amIHost) {
                const nextBtn = document.createElement('button');
                nextBtn.innerText = "Next Hand"; // Changed text!
                nextBtn.onclick = () => socket.emit('nextRound');
                UI.controls.appendChild(nextBtn);
            }
            break;

        case 'ROUND_OVER':
            UI.card.className = 'card';
            UI.card.innerHTML = `<div style="font-size: 4rem;"></div>`; 
            
            const roundLoser = gameState.players.find(p => p.penalties >= gameState.maxPenalties);
            UI.status.innerText = `ROUND OVER! ${roundLoser.name} collected 3 cards! Tallying scores...`;
            
            UI.gameOverOverlay.innerText = `${roundLoser.name} loses the round!`;
            UI.gameOverOverlay.classList.remove('hidden');
            
            setTimeout(() => { UI.gameOverOverlay.classList.add('hidden'); }, 3500);
            break;

        case 'FINAL_GAME_OVER':
            UI.card.className = 'card';
            UI.card.innerHTML = `<div style="font-size: 4rem;"></div>`; 
            
            let minScore = Math.min(...gameState.players.map(p => p.totalScore));
            let winners = gameState.players.filter(p => p.totalScore === minScore);
            let winnerNames = winners.map(w => w.name).join(' & ');

            UI.status.innerText = `GAME OVER! Lowest score wins! Returning to lobby...`;
            
            let superlativesHTML = '<div style="font-size: 1.5rem; margin-top: 20px; color: #d2dae2; text-shadow: none; text-transform: none;">';
            if (gameState.superlatives) {
                for (const [title, name] of Object.entries(gameState.superlatives)) {
                    if (name) superlativesHTML += `<div><strong>${title}:</strong> ${name}</div>`;
                }
            }
            superlativesHTML += '</div>';

            UI.gameOverOverlay.innerHTML = `${winnerNames} WINS!${superlativesHTML}`;
            UI.gameOverOverlay.classList.remove('hidden');
            
            setTimeout(() => { UI.gameOverOverlay.classList.add('hidden'); }, 12500);
            break;
    }
}

function renderPlayers() {
    UI.gameTable.innerHTML = ''; 
    
    const totalPlayers = gameState.players.length;
    const radius = 270; /* Increased to push players further out */
    const centerOffset = 325; /* Adjusted to match the new 650px CSS table center */

    // Find the local player's index to anchor them to the bottom
    let myIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (myIndex === -1) myIndex = 0; // Fallback

    gameState.players.forEach((p, index) => {
        // Calculate position relative to the local player
        const relativeIndex = (index - myIndex + totalPlayers) % totalPlayers;
        
        // Start at bottom (Math.PI / 2) and move counter-clockwise
        const angle = (Math.PI / 2) - (relativeIndex / totalPlayers) * (2 * Math.PI);
        
        const x = Math.cos(angle) * radius + centerOffset;
        const y = Math.sin(angle) * radius + centerOffset;

        const seat = document.createElement('div');
        const isActive = index === (gameState.phase === 'RESPOND' ? gameState.targetPlayerIndex : gameState.currentPlayerIndex);
        seat.className = `player-seat ${isActive ? 'active' : ''}`;
        seat.style.left = `${x}px`;
        seat.style.top = `${y}px`;

        let handHTML = '<div class="player-hand">';
        p.hand.forEach((card, cardIndex) => {
            // Security: Only make the card clickable if it's YOUR turn and YOUR card
            const isClickable = (gameState.phase === 'HOLDING' && index === gameState.currentPlayerIndex && cardIndex === 0 && p.socketId === socket.id);
            const clickAttr = isClickable ? `onclick="openPassMenu()"` : '';
            const clickClass = isClickable ? 'clickable' : '';

            if (gameState.phase === 'ANNOUNCE' || card.isFaceUp) {
                handHTML += `<div class="card"><img src="${card.item}.png" alt="${card.item}"></div>`;
            } else {
                handHTML += `<div class="card hidden ${clickClass}" ${clickAttr}><img src="${card.direction}.png" class="card-back-icon" alt="${card.direction}"></div>`;
            }
        });
        handHTML += '</div>';

        // Add a host crown icon next to the host's name
        const hostIcon = (gameState.hostId === p.socketId) ? '👑 ' : '';
        seat.innerHTML = `
            <div class="player-nameplate">
                <div class="name">${hostIcon}${p.name}</div>
                <div class="penalties">Cards: ${p.penalties} | Score: ${p.totalScore}</div>
            </div>
            ${handHTML}
        `;
        UI.gameTable.appendChild(seat);
    });

    const centerStage = document.createElement('div');
    centerStage.className = 'center-stage';
    centerStage.id = 'center-stage';
    
    let deckImageHTML = '';
    if (gameState.deck.length > 0) {
        const deckDir = gameState.itemDirections[gameState.deck[0]];
        deckImageHTML = `<img src="${deckDir}.png" class="card-back-icon" alt="${deckDir}">`;
    }
    
    // We removed the text label below the card so it perfectly centers
    centerStage.innerHTML = `
        <div id="active-card" class="card hidden">${deckImageHTML}</div>
    `;
    UI.gameTable.appendChild(centerStage);
    UI.card = document.getElementById('active-card');
}

// --- BUTTON ACTIONS (Emitting to Server) ---
UI.hostBtn.onclick = () => {
    const name = UI.playerNameInput.value.trim();
    if (!name) return alert("Please enter your name first!");
    socket.emit('hostGame', name);
    UI.playerNameInput.value = ''; 
};

UI.joinBtn.onclick = () => {
    const name = UI.playerNameInput.value.trim();
    if (!name) return alert("Please enter your name first!");
    
    if (currentRoomId) {
        // Joining via a shared URL parameter
        socket.emit('joinGame', { name: name, roomId: currentRoomId });
    } else {
        // Fallback: If they click join without a URL, prompt for the code
        const manualCode = prompt("Enter Room Code:");
        if (manualCode) {
            socket.emit('joinGame', { name: name, roomId: manualCode.trim() });
        }
    }
    UI.playerNameInput.value = ''; 
};

UI.startGameBtn.onclick = () => {
    socket.emit('startGame');
};

UI.rulesBtn.onclick = () => {
    UI.rulesModal.classList.remove('hidden');
};

UI.closeRulesBtn.onclick = () => {
    UI.rulesModal.classList.add('hidden');
};

function openPassMenu() {
    UI.declareInput.value = ''; 
    UI.targetSelect.innerHTML = ''; 

    const currentIdx = gameState.currentPlayerIndex;
    const numPlayers = gameState.players.length;
    
    // Safety check: ensure the player has a card to pass before opening menu
    const passingPlayer = gameState.players[currentIdx];
    if (!passingPlayer || passingPlayer.hand.length === 0) return;
    
    gameState.passDirectionRule = passingPlayer.hand[0].direction;

    let validTargets = [];
    if (gameState.passDirectionRule === 'right') {
        validTargets.push((currentIdx + 1) % numPlayers);
    } else if (gameState.passDirectionRule === 'left') {
        validTargets.push((currentIdx - 1 + numPlayers) % numPlayers);
    } else {
        for (let i = 0; i < numPlayers; i++) {
            if (i !== currentIdx) validTargets.push(i);
        }
    }

    // Force UI refresh of the select menu
    validTargets.forEach(targetIdx => {
        const targetPlayer = gameState.players[targetIdx];
        if (targetPlayer) {
            const opt = document.createElement('option');
            opt.value = targetIdx; // Pass the array index exactly as the server expects
            opt.innerText = targetPlayer.name;
            UI.targetSelect.appendChild(opt);
        }
    });

    UI.modal.classList.remove('hidden');
}

UI.cancelPassBtn.onclick = () => {
    UI.modal.classList.add('hidden');
};

UI.submitPassBtn.onclick = () => {
    const typedText = UI.declareInput.value.trim().toLowerCase();
    if (!typedText) {
        alert("You must declare what the item is!");
        return;
    }

    socket.emit('passCard', {
        declaredItem: typedText,
        targetPlayerIndex: parseInt(UI.targetSelect.value)
    });
    UI.modal.classList.add('hidden');
};

// --- CHAT LOGIC ---
socket.on('chatMessage', (data) => {
    // Generate local 12-hour timestamp directly on the player's device
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    minutes = minutes < 10 ? '0' + minutes : minutes;
    const timeString = hours + ':' + minutes + ' ' + ampm;

    const msgDiv = document.createElement('div');
    msgDiv.innerHTML = `<span class="chat-msg-time">${timeString}</span> <span class="chat-msg-name">${data.name}:</span> <span class="chat-msg-text">${data.message}</span>`;
    UI.chatMessages.appendChild(msgDiv);
    UI.chatMessages.scrollTop = UI.chatMessages.scrollHeight; 
});

function sendEmote(emoteChar) {
    socket.emit('sendEmote', emoteChar);
}

socket.on('receiveEmote', (data) => {
    // Find the seat of the player who sent the emote
    if (!gameState) return;
    const playerIndex = gameState.players.findIndex(p => p.socketId === data.socketId);
    if (playerIndex === -1) return;
    
    // We get the rendered seats by relying on their order in the DOM
    const seats = document.querySelectorAll('.player-seat');
    
    // The seats are appended to the DOM in the exact order of the players array!
    const targetSeat = seats[playerIndex];
    
    if (targetSeat) {
        const floatDiv = document.createElement('div');
        floatDiv.className = 'floating-emote';
        floatDiv.innerText = data.emote;
        targetSeat.appendChild(floatDiv);
        
        // Clean it up after the animation finishes
        setTimeout(() => { floatDiv.remove(); }, 2000);
    }
});

function sendChatMessage() {
    const msg = UI.chatInput.value.trim();
    if (msg) {
        socket.emit('chatMessage', msg);
        UI.chatInput.value = ''; // Clears input field after sending
    }
}

UI.chatSendBtn.onclick = sendChatMessage;
UI.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage(); // Let players press Enter to send
});