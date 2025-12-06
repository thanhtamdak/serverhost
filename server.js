const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Lấy PORT của Render
const PORT = process.env.PORT || 3000;

// ============ USER JOIN / ROOM LOGIC ============
const rooms = {}; // rooms[roomId] = [{id,name}, ...]

io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    // JOIN
    socket.on("join", ({ roomId, name }) => {
        socket.join(roomId);

        // Thêm vào danh sách
        if(!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId].push({ id: socket.id, name });

        // Gửi toàn bộ user đã có trong phòng cho người mới
        const others = rooms[roomId].filter(u => u.id !== socket.id);
        socket.emit("all-users", others);

        // Thông báo cho người khác
        socket.to(roomId).emit("user-joined", { id: socket.id, name });

        console.log(`${name} joined room ${roomId}`);
    });

    // SIGNAL WEBRTC
    socket.on("signal", (data) => {
        io.to(data.to).emit("signal", {
            from: data.from,
            signal: data.signal
        });
    });

    // MEDIA UPDATE
    socket.on("media-update", (data) => {
        const roomId = getUserRoom(socket.id);
        if(roomId)
            socket.to(roomId).emit("media-update", { id: socket.id, ...data });
    });

    // CHAT
    socket.on("chat", ({ text }) => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);
        if(roomId && user)
            io.to(roomId).emit("chat", { id: socket.id, name: user.name, text });
    });

    // START PRESENT
    socket.on("start-present", () => {
        const roomId = getUserRoom(socket.id);
        const u = findUser(socket.id);
        socket.to(roomId).emit("start-present", { id: socket.id, name: u.name });
    });

    // STOP PRESENT
    socket.on("stop-present", () => {
        const roomId = getUserRoom(socket.id);
        socket.to(roomId).emit("stop-present", { id: socket.id });
    });

    // DISCONNECT
    socket.on("disconnect", () => {
        const roomId = getUserRoom(socket.id);
        if(roomId){
            const user = findUser(socket.id);
            rooms[roomId] = rooms[roomId].filter(u => u.id !== socket.id);
            io.to(roomId).emit("user-left", { id: socket.id, name: user?.name });
        }
    });
});

// Helpers
function getUserRoom(id){
    for(const r in rooms){
        if(rooms[r].some(u => u.id === id)) return r;
    }
    return null;
}
function findUser(id){
    for(const r in rooms){
        const u = rooms[r].find(u => u.id === id);
        if(u) return u;
    }
    return null;
}

server.listen(PORT, () => console.log(`Server on ${PORT}`));
