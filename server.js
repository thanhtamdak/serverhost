const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Tự động lấy PORT của Render
const PORT = process.env.PORT || 3000;

// Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Khi join room
    socket.on("join-room", (roomId, userName) => {
        socket.join(roomId);
        socket.to(roomId).emit("user-connected", socket.id, userName);
    });

    // Truyền tín hiệu WebRTC (SimplePeer)
    socket.on("signal", (data) => {
        io.to(data.to).emit("signal", {
            from: data.from,
            signal: data.signal
        });
    });

    // Chat
    socket.on("chat", (data) => {
        io.to(data.room).emit("chat", data);
    });

    // Share màn hình
    socket.on("screen-share", (data) => {
        socket.to(data.room).emit("screen-share", data);
    });

    // Khi user ngắt kết nối
    socket.on("disconnect", () => {
        io.emit("user-disconnected", socket.id);
        console.log("User disconnected:", socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
