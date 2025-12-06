// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// QUAN TRỌNG: cho phép InfinityFree kết nối
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Bạn có thể bỏ static nếu frontend không chạy ở Render
// app.use(express.static(path.join(__dirname, 'public')));

// rooms: Map roomId => Map(socketId => { name })
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', ({ roomId, name }) => {
    socket.join(roomId);
    socket.data.name = name || 'Guest';
    socket.data.roomId = roomId;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const roomMap = rooms.get(roomId);

    const peers = Array.from(roomMap.entries()).map(([id, meta]) => ({
      id, name: meta.name
    }));
    socket.emit('all-users', peers);

    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      name: socket.data.name
    });

    roomMap.set(socket.id, { name: socket.data.name });
  });

  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', data);
  });

  socket.on('media-update', (payload) => {
    const roomId = socket.data.roomId;
    socket.to(roomId).emit('media-update', {
      id: socket.id,
      ...payload
    });
  });

  socket.on('chat', (payload) => {
    const roomId = socket.data.roomId;
    io.to(roomId).emit('chat', {
      id: socket.id,
      name: socket.data.name,
      text: payload.text
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (rooms.has(roomId)) {
      rooms.get(roomId).delete(socket.id);
      socket.to(roomId).emit('user-left', {
        id: socket.id,
        name: socket.data.name
      });
      if (rooms.get(roomId).size === 0) rooms.delete(roomId);
    }
  });
});

server.listen(process.env.PORT || 3000, () =>
  console.log("Server running")
);
