const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Tell the server to send the files in the 'public' folder to anyone who visits the website
app.use(express.static('public'));

// Listen for players connecting
io.on('connection', (socket) => {
    console.log(`A player connected! ID: ${socket.id}`);

    // If a player disconnects
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
    });
});

// Start the server (Render provides the PORT environment variable)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});