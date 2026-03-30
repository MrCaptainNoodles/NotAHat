// Connect to the backend server
const socket = io();

// Local copy of the state, updated constantly by the server
let gameState = null;

// --- DOM ELEMENTS ---
const UI = {
    status: document.getElementById('status-message'),
    gameTable: document.getElementById('game-table'),
    controls: document.getElementById('action-controls'),
    lobbyArea: document.getElementById('lobby-area'),
    playArea: document.getElementById('play-area'),
    playerNameInput: document.getElementById('player-name-input'),
    joinBtn: document.getElementById('join-btn'),
    lobbyPlayerList: document.getElementById('lobby-player-list'),
    startGameBtn: document.getElementById('start-game-btn'),
    modal: document.getElementById('pass-modal'),
    declareInput: document.getElementById('declare-input'), 
    targetSelect: document.getElementById('target-select'),
    submitPassBtn: document.getElementById('submit-pass-btn'),
    cancelPassBtn: document.getElementById('cancel-pass-btn')
};

// --- LISTEN FOR SERVER UPDATES ---
socket.on('stateUpdate', (newState) => {
    gameState = newState;
    render();
});

// --- RENDER LOGIC ---
function renderLobby() {
    UI.lobbyPlayerList.innerHTML = '';
    gameState.players.forEach(p => {
        const pDiv = document.createElement('div');
        pDiv.innerText = `👤 ${p.name}`;
        UI.lobbyPlayerList.appendChild(pDiv);
    });

    if (gameState.players.length >= 2) {
        UI.startGameBtn.classList.remove('hidden');
    } else {
        UI.startGameBtn.classList.add('hidden');
    }
}

function render() {
    if (!gameState) return; // Wait until server sends first state

    if (gameState.phase === 'LOBBY') {
        UI.lobbyArea.classList.remove('hidden');
        UI.playArea.classList.add('hidden');
        renderLobby();
        return; 
    } else {
        UI.lobbyArea.classList.add('hidden');
        UI.playArea.classList.remove('hidden');
    }

    renderPlayers();
    UI.controls.innerHTML = ''; 
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    switch(gameState.phase) {
        case 'ANNOUNCE':
            UI.status.innerText = `Memorize everyone's starting cards! Game starts in ${gameState.countdown}...`;
            break;

        case 'DRAW':
            UI.status.innerText = `${currentPlayer.name}'s turn. Click the center deck to draw.`;
            UI.card.className = 'card hidden clickable'; 
            
            // This line is vital to show the deck image!
            const deckDir = gameState.itemDirections[gameState.deck[0]];
            UI.card.innerHTML = `<img src="${deckDir}.png" class="card-back-icon" alt="${deckDir}">`;
            
            UI.card.onclick = () => socket.emit('drawCard'); 
            break;

        case 'HOLDING':
            UI.status.innerText = `${currentPlayer.name}, click your OLD card to pass it.`;
            UI.card.style.display = 'none'; 
            break;

        case 'RESPOND':
            UI.card.style.display = 'flex'; 
            UI.card.className = 'card hidden';
            UI.card.innerHTML = `<img src="${gameState.transitCard.direction}.png" class="card-back-icon" alt="${gameState.transitCard.direction}">`;
            
            const targetPlayer = gameState.players[gameState.targetPlayerIndex];
            UI.status.innerText = `${currentPlayer.name} passed a "${gameState.declaredItem}" to ${targetPlayer.name}.`;
            
            const acceptBtn = document.createElement('button');
            acceptBtn.innerText = "Accept";
            acceptBtn.onclick = () => socket.emit('acceptCard');

            const challengeBtn = document.createElement('button');
            challengeBtn.className = "danger";
            challengeBtn.innerText = "Challenge!";
            challengeBtn.onclick = () => socket.emit('challengeCard');

            UI.controls.append(acceptBtn, challengeBtn);
            break;

        case 'REVEAL':
            UI.card.className = 'card';
            UI.card.innerHTML = `<img src="${gameState.actualItem}.png" alt="${gameState.actualItem}">`;
            
            const nextBtn = document.createElement('button');
            nextBtn.innerText = "Next Round";
            nextBtn.onclick = () => socket.emit('nextRound');
            UI.controls.appendChild(nextBtn);
            break;

        case 'GAME_OVER':
            UI.card.className = 'card';
            UI.card.innerHTML = `<div style="font-size: 4rem;">💀</div>`; 
            
            const losingPlayer = gameState.players.find(p => p.penalties >= gameState.maxPenalties);
            UI.status.innerText = `GAME OVER! ${losingPlayer.name} has reached ${gameState.maxPenalties} penalties!`;
            
            const restartBtn = document.createElement('button');
            restartBtn.className = "danger";
            restartBtn.innerText = "Play Again";
            restartBtn.onclick = () => socket.emit('fullReset');
            UI.controls.appendChild(restartBtn);
            break;
    }
}

function renderPlayers() {
    UI.gameTable.innerHTML = ''; 
    
    const totalPlayers = gameState.players.length;
    const radius = 220; 
    const centerOffset = 275; 

    gameState.players.forEach((p, index) => {
        const angle = (index / totalPlayers) * (2 * Math.PI) - (Math.PI / 2);
        const x = Math.cos(angle) * radius + centerOffset;
        const y = Math.sin(angle) * radius + centerOffset;

        const seat = document.createElement('div');
        seat.className = `player-seat ${index === (gameState.phase === 'RESPOND' ? gameState.targetPlayerIndex : gameState.currentPlayerIndex) ? 'active' : ''}`;
        seat.style.left = `${x}px`;
        seat.style.top = `${y}px`;

        let handHTML = '<div class="player-hand">';
        p.hand.forEach((card, cardIndex) => {
            const isClickable = (gameState.phase === 'HOLDING' && index === gameState.currentPlayerIndex && cardIndex === 0);
            const clickAttr = isClickable ? `onclick="openPassMenu()"` : '';
            const clickClass = isClickable ? 'clickable' : '';

            if (gameState.phase === 'ANNOUNCE') {
                handHTML += `<div class="card"><img src="${card.item}.png" alt="${card.item}"></div>`;
            } else {
                handHTML += `<div class="card hidden ${clickClass}" ${clickAttr}><img src="${card.direction}.png" class="card-back-icon" alt="${card.direction}"></div>`;
            }
        });
        handHTML += '</div>';

        seat.innerHTML = `
            <div>${p.name}</div>
            <div style="font-size: 0.8rem">Penalties: ${p.penalties}</div>
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
    
    centerStage.innerHTML = `
        <div id="active-card" class="card hidden">${deckImageHTML}</div>
        <div style="margin-top: 15px; font-weight: bold; color: #d2dae2; letter-spacing: 2px;">CENTER DECK</div>
    `;
    UI.gameTable.appendChild(centerStage);
    UI.card = document.getElementById('active-card');
}

// --- BUTTON ACTIONS (Emitting to Server) ---
UI.joinBtn.onclick = () => {
    const name = UI.playerNameInput.value.trim();
    if (!name) return;
    socket.emit('joinGame', name);
    UI.playerNameInput.value = ''; 
};

UI.startGameBtn.onclick = () => {
    socket.emit('startGame');
};

function openPassMenu() {
    UI.declareInput.value = ''; 
    UI.targetSelect.innerHTML = ''; 

    const currentIdx = gameState.currentPlayerIndex;
    const numPlayers = gameState.players.length;
    gameState.passDirectionRule = gameState.players[currentIdx].hand[0].direction;

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

    validTargets.forEach(targetIdx => {
        const opt = document.createElement('option');
        opt.value = targetIdx;
        opt.innerText = gameState.players[targetIdx].name;
        UI.targetSelect.appendChild(opt);
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

UI.status.innerText = "Connecting to server...";