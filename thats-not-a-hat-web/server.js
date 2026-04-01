const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- ROOM STATE MANAGER ---
// We now store multiple games in a dictionary keyed by Room ID
const rooms = {};

function createGameState(hostSocketId) {
    return {
        hostId: hostSocketId, // The socket ID of the lobby creator
        players: [],
        items: ['hat', 'mug', 'box', 'pizza', 'guitar', 'gas mask', 'ak47', 'turbine', 'power switch', 'ragdoll', 'scarecrow'],
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
}

// Generate a random 4-letter/number code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function syncRoom(roomId) {
    if (rooms[roomId]) {
        io.to(roomId).emit('stateUpdate', rooms[roomId]);
    }
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    
    // Track which room this specific socket is in
    let myRoomId = null;

    // --- LOBBY LOGIC ---
    socket.on('hostGame', (name) => {
        const roomId = generateRoomCode();
        myRoomId = roomId;
        socket.join(roomId);
        
        rooms[roomId] = createGameState(socket.id);
        rooms[roomId].players.push({
            id: 0,
            socketId: socket.id,
            name: name,
            penalties: 0,
            hand: []
        });
        
        socket.emit('roomCreated', roomId);
        syncRoom(roomId);
    });

    socket.on('joinGame', (data) => {
        const name = data.name;
        const roomId = data.roomId.toUpperCase();
        const room = rooms[roomId];
        
        if (!room) {
            socket.emit('errorMsg', 'Room not found!');
            return;
        }

        myRoomId = roomId;
        socket.join(roomId);

        // Rejoin Logic: If they closed the page, reconnect them to their old character
        const existingPlayer = room.players.find(p => p.name === name);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            // Restore host powers if they were the host or the first player
            if (room.hostId === existingPlayer.socketId || room.players[0].name === name) {
               room.hostId = socket.id;
            }
        } else {
            // Prevent joining mid-game if they are a brand new player
            if (room.phase !== 'LOBBY') {
                socket.emit('errorMsg', 'Game already started!');
                return;
            }
            room.players.push({
                id: room.players.length,
                socketId: socket.id,
                name: name,
                penalties: 0,
                hand: []
            });
        }
        
        socket.emit('joinedRoom', roomId);
        syncRoom(roomId);
    });

    // --- GAMEPLAY LOGIC ---
    socket.on('startGame', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        
        // Security check: Only the host can start the game
        if (socket.id !== gameState.hostId) return;
        if (gameState.players.length < 2 || gameState.players.length >= gameState.items.length) return;

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
        gameState.players.forEach(p => p.isReady = false);
        gameState.phase = 'ANNOUNCE';
        syncRoom(myRoomId);
    });

    socket.on('playerReady', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        if (gameState.phase !== 'ANNOUNCE') return;
        
        const player = gameState.players.find(p => p.socketId === socket.id);
        if (player) player.isReady = true;
        
        if (gameState.players.every(p => p.isReady)) {
            gameState.phase = 'DRAW';
        }
        syncRoom(myRoomId);
    });

    socket.on('drawCard', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        if (gameState.phase !== 'DRAW') return;
        
        const drawnCard = { item: gameState.deck[0], direction: gameState.itemDirections[gameState.deck[0]] };
        
        gameState.deck = [];
        gameState.drawnCardReveal = drawnCard;
        gameState.phase = 'DRAW_REVEAL';
        syncRoom(myRoomId);

        // Wait 3 seconds, then slide it into the player's hand face-down
        setTimeout(() => {
            if (!rooms[myRoomId] || rooms[myRoomId].phase !== 'DRAW_REVEAL') return;
            
            const room = rooms[myRoomId];
            const currentPlayer = room.players[room.currentPlayerIndex];
            
            currentPlayer.hand.push(room.drawnCardReveal);
            room.passDirectionRule = currentPlayer.hand[0].direction;
            room.drawnCardReveal = null;
            room.phase = 'HOLDING';
            
            syncRoom(myRoomId);
        }, 3000);
    });

    socket.on('passCard', (data) => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        if (gameState.phase !== 'HOLDING') return;
        
        const passingPlayer = gameState.players[gameState.currentPlayerIndex];
        gameState.transitCard = passingPlayer.hand.shift();
        delete gameState.transitCard.isFaceUp;
        gameState.actualItem = gameState.transitCard.item;
        gameState.declaredItem = data.declaredItem;
        gameState.targetPlayerIndex = data.targetPlayerIndex;
        gameState.phase = 'RESPOND';
        syncRoom(myRoomId);
    });

    socket.on('acceptCard', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        if (gameState.phase !== 'RESPOND') return;
        
        const targetPlayer = gameState.players[gameState.targetPlayerIndex];
        targetPlayer.hand.push(gameState.transitCard);
        gameState.transitCard = null;
        gameState.currentPlayerIndex = gameState.targetPlayerIndex;
        gameState.targetPlayerIndex = null;
        gameState.phase = 'HOLDING';
        syncRoom(myRoomId);
    });

    socket.on('challengeCard', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        if (gameState.phase !== 'RESPOND') return;
        
        const isBluff = gameState.actualItem !== gameState.declaredItem;
        const challenger = gameState.players[gameState.targetPlayerIndex];
        const passer = gameState.players[gameState.currentPlayerIndex];
        
        let loser = isBluff ? passer : challenger;
        loser.penalties += 1;
        gameState.currentPlayerIndex = loser.id;
        
        if (loser.penalties >= gameState.maxPenalties) {
            gameState.phase = 'GAME_OVER';
            io.to(myRoomId).emit('challengeResult', { loserId: loser.socketId, isGameOver: true });
            
            // Auto-return to lobby after 5 seconds so they can see the game over screen
            setTimeout(() => {
                if (rooms[myRoomId]) {
                    const room = rooms[myRoomId];
                    room.players.forEach(p => { p.penalties = 0; p.hand = []; });
                    room.itemDirections = {};
                    room.phase = 'LOBBY';
                    syncRoom(myRoomId);
                }
            }, 5000);

        } else {
            gameState.phase = 'REVEAL';
            io.to(myRoomId).emit('challengeResult', { loserId: loser.socketId, isGameOver: false });
        }
        syncRoom(myRoomId);
    });

    socket.on('nextRound', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        
        gameState.actualItem = null;
        gameState.declaredItem = null;
        gameState.targetPlayerIndex = null;
        
        let shuffledItems = [...gameState.items].sort(() => Math.random() - 0.5);
        gameState.players.forEach((p, index) => {
            p.hand = [{ item: shuffledItems[index], direction: gameState.itemDirections[shuffledItems[index]] }];
            p.isReady = false;
        });
        gameState.deck = [shuffledItems[gameState.players.length]];
        gameState.phase = 'ANNOUNCE';
        syncRoom(myRoomId);
    });

    socket.on('fullReset', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        
        gameState.players.forEach(p => { p.penalties = 0; p.hand = []; });
        gameState.itemDirections = {};
        gameState.phase = 'LOBBY';
        syncRoom(myRoomId);
    });

    socket.on('chatMessage', (msg) => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const room = rooms[myRoomId];
        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) return;

        // Broadcasts just the name and message, letting the client handle the time
        io.to(myRoomId).emit('chatMessage', {
            name: player.name,
            message: msg
        });
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id} from room ${myRoomId}`);
        // We do not delete them from the room here, so they can rejoin via URL + Name
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});