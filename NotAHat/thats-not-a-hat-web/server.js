const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- THE MASTER GAME STATE ---
let gameState = {
    players: [],
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
    phase: 'LOBBY',
    countdown: 0
};

// Helper to broadcast state to all players
function syncAll() {
    io.emit('stateUpdate', gameState);
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // Immediately give the new player the current board state
    socket.emit('stateUpdate', gameState);

    socket.on('joinGame', (name) => {
        if (gameState.phase !== 'LOBBY') return;
        gameState.players.push({
            id: gameState.players.length,
            socketId: socket.id,
            name: name,
            penalties: 0,
            hand: []
        });
        syncAll();
    });

    socket.on('startGame', () => {
        if (gameState.players.length < 2 || gameState.players.length >= gameState.items.length) return;

        // Shuffle and assign directions
        gameState.items.forEach(item => {
            if (!gameState.itemDirections[item]) {
                gameState.itemDirections[item] = gameState.directions[Math.floor(Math.random() * gameState.directions.length)];
            }
        });

        let shuffledItems = [...gameState.items].sort(() => Math.random() - 0.5);

        gameState.players.forEach((p, index) => {
            p.hand = [{ item: shuffledItems[index], direction: gameState.itemDirections[shuffledItems[index]] }];
        });

        gameState.deck = [shuffledItems[gameState.players.length]];
        gameState.phase = 'ANNOUNCE';
        gameState.countdown = 3;
        syncAll();

        // Server-side countdown timer
        const timer = setInterval(() => {
            gameState.countdown--;
            if (gameState.countdown > 0) {
                syncAll();
            } else {
                clearInterval(timer);
                gameState.phase = 'DRAW';
                syncAll();
            }
        }, 1000);
    });

    socket.on('drawCard', () => {
        if (gameState.phase !== 'DRAW') return;
        
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        const drawnCard = { item: gameState.deck[0], direction: gameState.itemDirections[gameState.deck[0]] };
        
        gameState.deck = [];
        currentPlayer.hand.push(drawnCard);
        gameState.passDirectionRule = currentPlayer.hand[0].direction;
        gameState.phase = 'HOLDING';
        syncAll();
    });

    socket.on('passCard', (data) => {
        if (gameState.phase !== 'HOLDING') return;
        
        const passingPlayer = gameState.players[gameState.currentPlayerIndex];
        gameState.transitCard = passingPlayer.hand.shift();
        gameState.actualItem = gameState.transitCard.item;
        gameState.declaredItem = data.declaredItem;
        gameState.targetPlayerIndex = data.targetPlayerIndex;
        gameState.phase = 'RESPOND';
        syncAll();
    });

    socket.on('acceptCard', () => {
        if (gameState.phase !== 'RESPOND') return;
        
        const targetPlayer = gameState.players[gameState.targetPlayerIndex];
        targetPlayer.hand.push(gameState.transitCard);
        gameState.transitCard = null;
        gameState.currentPlayerIndex = gameState.targetPlayerIndex;
        gameState.targetPlayerIndex = null;
        gameState.phase = 'HOLDING';
        syncAll();
    });

    socket.on('challengeCard', () => {
        if (gameState.phase !== 'RESPOND') return;
        
        const isBluff = gameState.actualItem !== gameState.declaredItem;
        const challenger = gameState.players[gameState.targetPlayerIndex];
        const passer = gameState.players[gameState.currentPlayerIndex];
        
        let loser = isBluff ? passer : challenger;
        loser.penalties += 1;
        gameState.currentPlayerIndex = loser.id;
        
        if (loser.penalties >= gameState.maxPenalties) {
            gameState.phase = 'GAME_OVER';
        } else {
            gameState.phase = 'REVEAL';
        }
        syncAll();
    });

    socket.on('nextRound', () => {
        gameState.actualItem = null;
        gameState.declaredItem = null;
        gameState.targetPlayerIndex = null;
        
        // Quick redeal without erasing penalties
        let shuffledItems = [...gameState.items].sort(() => Math.random() - 0.5);
        gameState.players.forEach((p, index) => {
            p.hand = [{ item: shuffledItems[index], direction: gameState.itemDirections[shuffledItems[index]] }];
        });
        gameState.deck = [shuffledItems[gameState.players.length]];
        gameState.phase = 'DRAW';
        syncAll();
    });

    socket.on('fullReset', () => {
        gameState.players.forEach(p => { p.penalties = 0; p.hand = []; });
        gameState.itemDirections = {};
        gameState.phase = 'LOBBY';
        syncAll();
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        // For production, you'd add logic here to handle a player dropping mid-game
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});