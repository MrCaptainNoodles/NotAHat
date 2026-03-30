// --- STATE MANAGEMENT ---
const gameState = {
    players: [], // Starts empty! Players will join via the lobby
    items: ['hat', 'mug', 'box', 'pizza', 'guitar'], 
    directions: ['left', 'right', 'any'],
    
    currentPlayerIndex: 0,
    targetPlayerIndex: null,
    actualItem: null,    
    declaredItem: null,  
    passDirectionRule: 'any', 
    itemDirections: {}, 
    deck: [], 
    transitCard: null, 
    maxPenalties: 3, 
    phase: 'LOBBY' // Game starts in the Lobby
};

// --- DOM ELEMENTS ---
const UI = {
    status: document.getElementById('status-message'),
    gameTable: document.getElementById('game-table'),
    controls: document.getElementById('action-controls'),
    
    // Lobby Elements
    lobbyArea: document.getElementById('lobby-area'),
    playArea: document.getElementById('play-area'),
    playerNameInput: document.getElementById('player-name-input'),
    joinBtn: document.getElementById('join-btn'),
    lobbyPlayerList: document.getElementById('lobby-player-list'),
    startGameBtn: document.getElementById('start-game-btn'),
    
    // Modal Elements
    modal: document.getElementById('pass-modal'),
    declareInput: document.getElementById('declare-input'), 
    targetSelect: document.getElementById('target-select'),
    submitPassBtn: document.getElementById('submit-pass-btn'),
    cancelPassBtn: document.getElementById('cancel-pass-btn')
};

// --- CORE LOGIC & RENDER ---
function renderLobby() {
    UI.lobbyPlayerList.innerHTML = '';
    gameState.players.forEach(p => {
        const pDiv = document.createElement('div');
        pDiv.innerText = `${p.name}`;
        UI.lobbyPlayerList.appendChild(pDiv);
    });

    // Need at least 2 players to start a game
    if (gameState.players.length >= 2) {
        UI.startGameBtn.classList.remove('hidden');
    } else {
        UI.startGameBtn.classList.add('hidden');
    }
}

function render() {
    // Hide/Show the correct screens based on phase
    if (gameState.phase === 'LOBBY') {
        UI.lobbyArea.classList.remove('hidden');
        UI.playArea.classList.add('hidden');
        renderLobby();
        return; // Stop rendering the rest of the game board
    } else {
        UI.lobbyArea.classList.add('hidden');
        UI.playArea.classList.remove('hidden');
    }

    renderPlayers();
    UI.controls.innerHTML = ''; 
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    switch(gameState.phase) {
        case 'DRAW':
            UI.status.innerText = `${currentPlayer.name}'s turn. Click the center deck to draw.`;
            UI.card.className = 'card hidden clickable'; // Added 'clickable' so it glows and acts like a button!
            // We removed the line that was deleting the HTML so the arrow stays visible!
            UI.card.onclick = handleDraw; 
            break;

        case 'HOLDING':
            UI.status.innerText = `${currentPlayer.name}, click your OLD card to pass it.`;
            UI.card.style.display = 'none'; // Hide the center card completely!
            break;

        case 'RESPOND':
            UI.card.style.display = 'flex'; // Bring center card back for the transit animation
            UI.card.className = 'card hidden';
            UI.card.innerHTML = `<img src="${gameState.transitCard.direction}.png" class="card-back-icon" alt="${gameState.transitCard.direction}">`;
            
            const targetPlayer = gameState.players[gameState.targetPlayerIndex];
            UI.status.innerText = `${currentPlayer.name} passed a "${gameState.declaredItem}" to ${targetPlayer.name}.`;
            
            const acceptBtn = document.createElement('button');
            acceptBtn.innerText = "Accept";
            acceptBtn.onclick = handleAccept;

            const challengeBtn = document.createElement('button');
            challengeBtn.className = "danger";
            challengeBtn.innerText = "Challenge!";
            challengeBtn.onclick = handleChallenge;

            UI.controls.append(acceptBtn, challengeBtn);
            break;

        case 'REVEAL':
            UI.card.className = 'card';
            UI.card.innerHTML = `<img src="${gameState.actualItem}.png" alt="${gameState.actualItem}">`;
            
            const nextBtn = document.createElement('button');
            nextBtn.innerText = "Next Round";
            nextBtn.onclick = resetRound;
            UI.controls.appendChild(nextBtn);
            break;

        case 'GAME_OVER':
            UI.card.className = 'card';
            // Show a skull emoji in the center card slot to indicate defeat
            UI.card.innerHTML = `<div style="font-size: 4rem;"></div>`; 
            
            // Find whoever has the max penalties so we can announce it
            const losingPlayer = gameState.players.find(p => p.penalties >= gameState.maxPenalties);
            UI.status.innerText = `GAME OVER! ${losingPlayer.name} has reached ${gameState.maxPenalties} penalties!`;
            
            const restartBtn = document.createElement('button');
            restartBtn.className = "danger";
            restartBtn.innerText = "Play Again";
            restartBtn.onclick = fullReset;
            UI.controls.appendChild(restartBtn);
            break;
    }
}

function renderPlayers() {
    UI.gameTable.innerHTML = ''; // Clear table
    
    const totalPlayers = gameState.players.length;
    const radius = 220; // How far players sit from the center
    const centerOffset = 275; // Half of the 550px table width

    gameState.players.forEach((p, index) => {
        // Geometric math to place players in a perfect circle
        const angle = (index / totalPlayers) * (2 * Math.PI) - (Math.PI / 2);
        const x = Math.cos(angle) * radius + centerOffset;
        const y = Math.sin(angle) * radius + centerOffset;

        const seat = document.createElement('div');
        seat.className = `player-seat ${index === (gameState.phase === 'RESPOND' ? gameState.targetPlayerIndex : gameState.currentPlayerIndex) ? 'active' : ''}`;
        seat.style.left = `${x}px`;
        seat.style.top = `${y}px`;

        // Draw the player's hand (supports 1 or 2 cards)
        let handHTML = '<div class="player-hand">';
        p.hand.forEach((card, cardIndex) => {
            // Check if this card should be clickable (It must be their turn, phase HOLDING, and it must be their OLDEST card (index 0))
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

    // Re-create the center stage where active cards are drawn/passed
    const centerStage = document.createElement('div');
    centerStage.className = 'center-stage';
    centerStage.id = 'center-stage';
    
    // If there is a card waiting in the deck, show its directional arrow
    let deckImageHTML = '';
    if (gameState.deck.length > 0) {
        const deckDir = gameState.itemDirections[gameState.deck[0]];
        deckImageHTML = `<img src="${deckDir}.png" class="card-back-icon" alt="${deckDir}">`;
    }
    
    // We recreate the active card element here so it stays in the middle
    centerStage.innerHTML = `
        <div id="active-card" class="card hidden">${deckImageHTML}</div>
        <div style="margin-top: 15px; font-weight: bold; color: #d2dae2; letter-spacing: 2px;"></div>
    `;
    UI.gameTable.appendChild(centerStage);
    
    // Re-link the active card to our UI object since we just rebuilt it
    UI.card = document.getElementById('active-card');
}

// --- ACTIONS ---

function handleDraw() {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    
    const drawnCard = {
        item: gameState.deck[0],
        direction: gameState.itemDirections[gameState.deck[0]]
    };
    
    UI.card.className = 'card';
    UI.card.innerHTML = `<img src="${drawnCard.item}.png" alt="${drawnCard.item}">`;
    UI.status.innerText = `You drew a ${drawnCard.item}! Memorize it...`;
    UI.card.onclick = null;
    
    setTimeout(() => {
        gameState.deck = []; // Empty the center deck
        currentPlayer.hand.push(drawnCard); // Add it to player's hand (they now hold 2)
        
        // Update pass rule based on the OLD card they are about to pass
        gameState.passDirectionRule = currentPlayer.hand[0].direction; 
        
        gameState.phase = 'HOLDING';
        renderPlayers(); 
        render(); 
    }, 2500);
}

// Opens the modal where the user types the declaration and selects a target
function openPassMenu() {
    UI.declareInput.value = ''; 
    UI.targetSelect.innerHTML = ''; 

    const currentIdx = gameState.currentPlayerIndex;
    const numPlayers = gameState.players.length;

    // The direction rule is based on the OLD card (index 0)
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

    const passingPlayer = gameState.players[gameState.currentPlayerIndex];
    
    // Remove the oldest card from their hand and put it in transit
    gameState.transitCard = passingPlayer.hand.shift(); 
    gameState.actualItem = gameState.transitCard.item; 
    
    gameState.declaredItem = typedText;
    gameState.targetPlayerIndex = parseInt(UI.targetSelect.value);
    
    UI.modal.classList.add('hidden');
    gameState.phase = 'RESPOND';
    renderPlayers(); 
    render();
};

function handleAccept() {
    const targetPlayer = gameState.players[gameState.targetPlayerIndex];
    
    // Add the transit card to the target's hand
    targetPlayer.hand.push(gameState.transitCard);
    gameState.transitCard = null;
    
    gameState.currentPlayerIndex = gameState.targetPlayerIndex;
    gameState.targetPlayerIndex = null;
    gameState.phase = 'HOLDING'; 
    
    renderPlayers(); 
    render();
}

function handleChallenge() {
    const isBluff = gameState.actualItem !== gameState.declaredItem;
    const challenger = gameState.players[gameState.targetPlayerIndex];
    const passer = gameState.players[gameState.currentPlayerIndex];
    
    let loser; // We will track who just lost the challenge

    if (isBluff) {
        UI.status.innerText = `Successful Challenge! It was a ${gameState.actualItem}. ${passer.name} gets a penalty.`;
        passer.penalties += 1;
        gameState.currentPlayerIndex = passer.id; 
        loser = passer;
    } else {
        UI.status.innerText = `Failed Challenge! It really was a ${gameState.actualItem}. ${challenger.name} gets a penalty.`;
        challenger.penalties += 1;
        gameState.currentPlayerIndex = challenger.id; 
        loser = challenger;
    }
    
    // Check if the loser has hit the penalty limit
    if (loser.penalties >= gameState.maxPenalties) {
        gameState.phase = 'GAME_OVER';
    } else {
        gameState.phase = 'REVEAL';
    }
    
    render();
}

function resetRound() {
    // A challenge ruins the table's hands, so we redeal the whole board but keep penalties
    gameState.actualItem = null;
    gameState.declaredItem = null;
    gameState.targetPlayerIndex = null;
    startNewGame();
}

function fullReset() {
    // Completely wipe the board to play a brand new game
    gameState.players.forEach(p => {
        p.penalties = 0;
        p.hand = [];
    });
    gameState.actualItem = null;
    gameState.declaredItem = null;
    gameState.targetPlayerIndex = null;
    gameState.itemDirections = {}; // Resets the locked directions for a new shuffle
    
    startNewGame();
}

// --- INITIALIZATION & DEAL ---
function startNewGame() {
    // Assign permanent directions if they haven't been assigned yet
    if (Object.keys(gameState.itemDirections).length === 0) {
        gameState.items.forEach(item => {
            gameState.itemDirections[item] = gameState.directions[Math.floor(Math.random() * gameState.directions.length)];
        });
    }

    // Create a shuffled copy of the items array to ensure unique cards
    let shuffledItems = [...gameState.items];
    for (let i = shuffledItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledItems[i], shuffledItems[j]] = [shuffledItems[j], shuffledItems[i]];
    }

    // Deal 1 unique card to every player's hand
    gameState.players.forEach((p, index) => {
        p.hand = []; // Reset hand
        const item = shuffledItems[index];
        p.hand.push({
            item: item,
            direction: gameState.itemDirections[item] 
        });
    });

    // Dynamically assign the next available card to the center deck
    gameState.deck = [shuffledItems[gameState.players.length]];
    
    gameState.phase = 'ANNOUNCE';
    
    // Create a visual 3-second countdown so the game doesn't feel frozen!
    let countdown = 3;
    UI.status.innerText = `Memorize everyone's starting cards! Game starts in ${countdown}...`;
    render(); 
    
    const timer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            UI.status.innerText = `Memorize everyone's starting cards! Game starts in ${countdown}...`;
        } else {
            clearInterval(timer); // Stop the timer
            gameState.phase = 'DRAW';
            render(); // Renders the board with the clickable deck
        }
    }, 1000);
}

// --- LOBBY ACTIONS ---
UI.joinBtn.onclick = () => {
    const name = UI.playerNameInput.value.trim();
    if (!name) return; // Ignore empty names

    // Add new player to the state array
    gameState.players.push({
        id: gameState.players.length,
        name: name,
        penalties: 0,
        hand: []
    });

    UI.playerNameInput.value = ''; // Clear input
    renderLobby();
};

UI.startGameBtn.onclick = () => {
    // Only start if we have enough items for everyone + 1 for the deck
    if (gameState.players.length >= gameState.items.length) {
        alert("Too many players for the amount of items in the deck!");
        return;
    }
    startNewGame();
};

// Initialize
UI.status.innerText = "Welcome! Add players to begin.";
render(); // Will default to rendering the LOBBY phase