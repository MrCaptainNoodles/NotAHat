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
        // 31 Items
        items: ['hat', 'mug', 'box', 'pizza', 'guitar', 
            'gas mask', 'ak47', 'turbine', 'power switch', 'ragdoll',
            'scarecrow', 'thimble', 'needle', 'bullet', 'noose',
            'radio', 'gloves', 'knife', 'gem', 'pyramid',
            'coin', 'floppy disk', 'pliers', 'boots', 'trashcan',
        'crowbar', 'lighter', 'sun', 'moon', 'spoon',
    'ball of yarn', 'boomstick'],
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
        if (myRoomId) return; // Prevent multiple requests if button is double-clicked
        
        const roomId = generateRoomCode();
        myRoomId = roomId;
        socket.join(roomId);
        
        rooms[roomId] = createGameState(socket.id);
        rooms[roomId].players.push({
            id: 0,
            socketId: socket.id,
            name: name,
            penalties: 0,
            totalScore: 0,
            winStreak: 0,
            hand: [],
            stats: { successfulBluffs: 0, incorrectChallenges: 0, bluffsAccepted: 0, truthsPassed: 0, challengesInitiated: 0, timesTargeted: 0, totalThinkTime: 0, decisionsMade: 0 }
        });
        
        socket.emit('roomCreated', roomId);
        syncRoom(roomId);
    });

    socket.on('joinGame', (data) => {
        if (myRoomId) return; // Prevent multiple requests if button is double-clicked
        
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
                winStreak: 0,
                hand: [],
                stats: { successfulBluffs: 0, incorrectChallenges: 0, bluffsAccepted: 0, truthsPassed: 0, challengesInitiated: 0, timesTargeted: 0, totalThinkTime: 0, decisionsMade: 0 }
            });
        }
        
        socket.emit('joinedRoom', roomId);
        syncRoom(roomId);
    });

    socket.on('kickPlayer', (targetSocketId) => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const room = rooms[myRoomId];
        
        // Only the host can kick, and they cannot kick themselves
        if (room.hostId !== socket.id || targetSocketId === socket.id) return;
        
        const playerIndex = room.players.findIndex(p => p.socketId === targetSocketId);
        if (playerIndex !== -1) {
            // Remove the player
            room.players.splice(playerIndex, 1);
            
            // Re-assign IDs to maintain array alignment
            room.players.forEach((p, index) => p.id = index);
            
            // Boot the socket out of the room
            io.to(targetSocketId).emit('kicked', 'You have been kicked by the host.');
            io.in(targetSocketId).socketsLeave(myRoomId);
            
            // If they were kicked mid-game, emergency abort back to the lobby
            if (room.phase !== 'LOBBY') {
                room.phase = 'LOBBY';
                room.players.forEach(p => { p.penalties = 0; p.totalScore = 0; p.hand = []; });
                room.itemDirections = {};
                room.superlatives = null;
                io.to(myRoomId).emit('chatMessage', { name: "System", message: "A player was kicked. The game has been returned to the lobby." });
            }
            
            syncRoom(myRoomId);
        }
    });

    // --- GAMEPLAY LOGIC ---
    socket.on('startGame', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        
        // Security check: Only the host can start the game
        if (socket.id !== gameState.hostId) return;
        if (gameState.players.length < 2 || gameState.players.length >= gameState.items.length) return;

        gameState.maxRounds = gameState.players.length;
        gameState.currentRound = 1;

        gameState.items.forEach(item => {
            if (!gameState.itemDirections[item]) {
                gameState.itemDirections[item] = gameState.directions[Math.floor(Math.random() * gameState.directions.length)];
            }
        });

        let shuffledItems = [...gameState.items].sort(() => Math.random() - 0.5);

        gameState.players.forEach((p, index) => {
            p.totalScore = 0;
            p.penalties = 0;
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
        
        // Track stats
        gameState.players[gameState.targetPlayerIndex].stats.timesTargeted++;
        if (gameState.actualItem === gameState.declaredItem) passingPlayer.stats.truthsPassed++;
        gameState.phaseStartTime = Date.now(); // Start the overthinker clock!
        
        gameState.phase = 'RESPOND';
        syncRoom(myRoomId);
    });

    socket.on('acceptCard', () => {
        if (!myRoomId || !rooms[myRoomId]) return;
        const gameState = rooms[myRoomId];
        if (gameState.phase !== 'RESPOND') return;
        
        const targetPlayer = gameState.players[gameState.targetPlayerIndex];
        
        // Track stats
        const passingPlayer = gameState.players[gameState.currentPlayerIndex];
        const thinkTime = Date.now() - (gameState.phaseStartTime || Date.now());
        targetPlayer.stats.totalThinkTime += thinkTime;
        targetPlayer.stats.decisionsMade++;
        if (gameState.actualItem !== gameState.declaredItem) {
            targetPlayer.stats.bluffsAccepted++;
            passingPlayer.stats.successfulBluffs++;
        }

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
        
        // Track stats
        const thinkTime = Date.now() - (gameState.phaseStartTime || Date.now());
        challenger.stats.totalThinkTime += thinkTime;
        challenger.stats.decisionsMade++;
        challenger.stats.challengesInitiated++;
        if (!isBluff) challenger.stats.incorrectChallenges++;

        let loser = isBluff ? passer : challenger;
        loser.penalties += 1;
        gameState.currentPlayerIndex = loser.id; // Forces the loser to draw first next round
        
        if (loser.penalties >= gameState.maxPenalties) {
            
            // Golf rules: Add everyone's collected cards to their permanent score
            gameState.players.forEach(p => p.totalScore += p.penalties);

            // Check if that was the final round
            if (gameState.currentRound >= gameState.maxRounds) {
                gameState.phase = 'FINAL_GAME_OVER';
                
                // Calculate actual winners (Lowest Score)
                let minScore = Math.min(...gameState.players.map(p => p.totalScore));
                let winners = gameState.players.filter(p => p.totalScore === minScore);
                
                // Update win streaks
                gameState.players.forEach(p => {
                    if (p.totalScore === minScore) p.winStreak += 1;
                    else p.winStreak = 0;
                });

                // Calculate Superlatives
                const getTop = (statFn) => {
                    let topPlayer = null;
                    let maxVal = -1;
                    gameState.players.forEach(p => {
                        const val = statFn(p);
                        if (val > maxVal && val > 0) { maxVal = val; topPlayer = p.name; }
                    });
                    return topPlayer;
                };

                gameState.superlatives = {
                    "The Mastermind": getTop(p => p.stats.successfulBluffs),
                    "The Paranoid": getTop(p => p.stats.incorrectChallenges),
                    "The Gullible": getTop(p => p.stats.bluffsAccepted),
                    "The Honest Abe": getTop(p => p.stats.truthsPassed),
                    "The Instigator": getTop(p => p.stats.challengesInitiated),
                    "The Target": getTop(p => p.stats.timesTargeted),
                    "The Overthinker": getTop(p => p.stats.decisionsMade > 0 ? (p.stats.totalThinkTime / p.stats.decisionsMade) : 0)
                };

                io.to(myRoomId).emit('finalGameOver', { winnerIds: winners.map(w => w.socketId) });
                
                setTimeout(() => {
                    if (rooms[myRoomId]) {
                        const room = rooms[myRoomId];
                        room.players.forEach(p => { 
                            p.penalties = 0; p.totalScore = 0; p.hand = []; 
                            p.stats = { successfulBluffs: 0, incorrectChallenges: 0, bluffsAccepted: 0, truthsPassed: 0, challengesInitiated: 0, timesTargeted: 0, totalThinkTime: 0, decisionsMade: 0 }; 
                        });
                        room.itemDirections = {};
                        room.superlatives = null;
                        room.phase = 'LOBBY';
                        syncRoom(myRoomId);
                    }
                }, 13000); // Increased to 13 seconds so players can read the stats!

            } else {
                gameState.phase = 'ROUND_OVER';
                io.to(myRoomId).emit('roundOver');
                
                // Automatically re-deal and start the next round
                setTimeout(() => {
                    if (rooms[myRoomId]) {
                        const room = rooms[myRoomId];
                        room.currentRound++;
                        room.players.forEach(p => { p.penalties = 0; }); // Clear cards for new round
                        
                        // Critical Fix: Reset target index for the new round
                        room.targetPlayerIndex = null; 
                        
                        let shuffledItems = [...room.items].sort(() => Math.random() - 0.5);
                        room.players.forEach((p, index) => {
                            p.hand = [{ item: shuffledItems[index], direction: room.itemDirections[shuffledItems[index]] }];
                            p.isReady = false;
                        });
                        room.deck = [shuffledItems[room.players.length]];
                        room.phase = 'ANNOUNCE';
                        syncRoom(myRoomId);
                    }
                }, 5000);
            }

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

    socket.on('sendEmote', (emote) => {
        if (!myRoomId || !rooms[myRoomId]) return;
        io.to(myRoomId).emit('receiveEmote', { socketId: socket.id, emote: emote });
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