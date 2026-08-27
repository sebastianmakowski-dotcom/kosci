const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

app.use(express.static('public'));

const rooms = {};
const CATEGORIES = ['Jedynki', 'Dwójki', 'Trójki', 'Czwórki', 'Piątki', 'Szóstki', 'Para', 'Dwie Pary', 'Trójka', 'Full', 'Parzyste', 'Nieparzyste', 'Mały Strit', 'Duży Strit', 'Kareta', 'Generał', 'Szansa'];

function createInitialScores(categories) {
    const scores = {};
    categories.forEach(cat => scores[cat] = null);
    return scores;
}

function calculateScore(category, dice, isZreki) {
    const counts = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
    let sum = 0;
    dice.forEach(d => { counts[d]++; sum += d; });
    let score = 0;
    let applyMulti = false;

    if (category === 'Jedynki') score = (counts[1] - 3) * 1;
    else if (category === 'Dwójki') score = (counts[2] - 3) * 2;
    else if (category === 'Trójki') score = (counts[3] - 3) * 3;
    else if (category === 'Czwórki') score = (counts[4] - 3) * 4;
    else if (category === 'Piątki') score = (counts[5] - 3) * 5;
    else if (category === 'Szóstki') score = (counts[6] - 3) * 6;
    else if (category === 'Para') { applyMulti = true; for (let i = 6; i >= 1; i--) { if (counts[i] >= 2) { score = i * 2; break; } } }
    else if (category === 'Dwie Pary') { applyMulti = true; let pairs = []; for (let i = 6; i >= 1; i--) { if (counts[i] >= 2) pairs.push(i); } if (pairs.length >= 2) score = pairs[0]*2 + pairs[1]*2; else if (pairs.length === 1 && counts[pairs[0]] >= 4) score = pairs[0]*4; }
    else if (category === 'Trójka') { applyMulti = true; for (let i = 6; i >= 1; i--) { if (counts[i] >= 3) { score = i * 3; break; } } }
    else if (category === 'Full') { applyMulti = true; let has3 = 0, has2 = 0; for (let i = 6; i >= 1; i--) { if (counts[i] === 3) has3 = i; else if (counts[i] === 2) has2 = i; } if (has3 && has2) score = (has3 * 3) + (has2 * 2); }
    else if (category === 'Parzyste') { applyMulti = true; if (dice.every(d => d % 2 === 0)) score = sum; }
    else if (category === 'Nieparzyste') { applyMulti = true; if (dice.every(d => d % 2 !== 0)) score = sum; }
    else if (category === 'Mały Strit') { applyMulti = true; if ([1,2,3,4,5].every(v => counts[v] >= 1)) score = 15; }
    else if (category === 'Duży Strit') { applyMulti = true; if ([2,3,4,5,6].every(v => counts[v] >= 1)) score = 20; }
    else if (category === 'Kareta') { applyMulti = true; if (Object.values(counts).some(c => c >= 4)) score = 30; }
    else if (category === 'Generał') { applyMulti = true; if (Object.values(counts).some(c => c === 5)) score = 50; }
    else if (category === 'Szansa') { score = sum; }

    if (applyMulti && isZreki && score > 0) score *= 2;
    return score;
}

io.on('connection', (socket) => {
    console.log(`[LOG] Nowe połączenie zweryfikowane: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, playerName }) => {
        console.log(`[LOG] Gracz "${playerName}" dołącza do pokoju: ${roomId}`);
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = { id: roomId, players: [], currentPlayerIndex: 0, gameState: { dice: [1,1,1,1,1], heldDice: [false,false,false,false,false], rollsLeft: 3, started: false, lastRollWasFull: false } };
        }

        const room = rooms[roomId];
        let player = room.players.find(p => p.id === socket.id);
        if (!player) {
            player = { id: socket.id, name: playerName, currentRoom: roomId, scores: createInitialScores(CATEGORIES) };
            room.players.push(player);
        } else {
            player.currentRoom = roomId;
        }

        // WYŚLIJ GLOBALNIE DO WSZYSTKICH (Przeglądarka zignoruje, jeśli to nie jej pokój)
        io.emit('updateRoom', room);
        console.log(`[LOG] Wysłano globalny update dla pokoju ${roomId}. Liczba osób: ${room.players.length}`);
    });

    socket.on('startGame', () => {
        const playerRoom = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));
        if (playerRoom) {
            playerRoom.gameState.started = true;
            io.emit('updateRoom', playerRoom);
        }
    });

    socket.on('roll', () => {
        const playerRoom = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));
        if (!playerRoom) return;
        const activePlayer = playerRoom.players[playerRoom.currentPlayerIndex];
        if (activePlayer?.id === socket.id && playerRoom.gameState.rollsLeft > 0) {
            let rolledCount = 0;
            for (let i = 0; i < 5; i++) {
                if (!playerRoom.gameState.heldDice[i]) { playerRoom.gameState.dice[i] = Math.floor(Math.random() * 6) + 1; rolledCount++; }
            }
            playerRoom.gameState.lastRollWasFull = (rolledCount === 5);
            playerRoom.gameState.rollsLeft--;
            io.emit('updateRoom', playerRoom);
        }
    });

    socket.on('hold', (index) => {
        const playerRoom = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));
        if (!playerRoom) return;
        const activePlayer = playerRoom.players[playerRoom.currentPlayerIndex];
        if (activePlayer?.id === socket.id && playerRoom.gameState.rollsLeft < 3) {
            playerRoom.gameState.heldDice[index] = !playerRoom.gameState.heldDice[index];
            io.emit('updateRoom', playerRoom);
        }
    });

    socket.on('saveScore', (category) => {
        const playerRoom = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));
        if (!playerRoom) return;
        const activePlayer = playerRoom.players[playerRoom.currentPlayerIndex];
        if (activePlayer?.id === socket.id && activePlayer.scores[category] === null) {
            activePlayer.scores[category] = calculateScore(category, playerRoom.gameState.dice, playerRoom.gameState.lastRollWasFull);
            playerRoom.gameState.dice = [1,1,1,1,1];
            playerRoom.gameState.heldDice = [false,false,false,false,false];
            playerRoom.gameState.rollsLeft = 3;
            playerRoom.gameState.lastRollWasFull = false;
            playerRoom.currentPlayerIndex = (playerRoom.currentPlayerIndex + 1) % playerRoom.players.length;
            io.emit('updateRoom', playerRoom);
        }
    });

    socket.on('disconnect', () => {
        Object.keys(rooms).forEach(roomId => {
            const room = rooms[roomId];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) delete rooms[roomId];
            else {
                if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
                io.emit('updateRoom', room);
            }
        });
        console.log(`[LOG] Klient się rozłączył.`);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`[LOG] Serwer gotowy na porcie ${PORT}`));
