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

const PORT = process.env.PORT || 3000;

// Cấu trúc phòng nâng cao
const rooms = {}; 
// rooms[roomId] = {
//   users: [{ id, name, isHost, raisedHand, muted }],
//   presenter: socket.id | null,
//   reactions: [] // { name, emoji, timestamp }
// }

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // ==================== JOIN PHÒNG ====================
    socket.on("join", ({ roomId, name }) => {
        socket.join(roomId);
        name = name.trim() || `User${Math.floor(Math.random() * 9999)}`;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                presenter: null,
                reactions: []
            };
        }

        const isHost = rooms[roomId].users.length === 0; // Người đầu tiên là host

        const user = {
            id: socket.id,
            name,
            isHost,
            raisedHand: false,
            muted: false
        };

        rooms[roomId].users.push(user);

        // Gửi danh sách tất cả người dùng (bao gồm bản thân để hiển thị đúng tên)
        const allUsers = rooms[roomId].users.map(u => ({ id: u.id, name: u.name, isHost: u.isHost, raisedHand: u.raisedHand }));
        socket.emit("all-users", allUsers);

        // Thông báo người mới cho những người khác
        socket.to(roomId).emit("user-joined", { id: socket.id, name, isHost });

        // Nếu có người đang chia sẻ → thông báo cho người mới
        if (rooms[roomId].presenter) {
            const presenter = rooms[roomId].users.find(u => u.id === rooms[roomId].presenter);
            if (presenter) {
                socket.emit("start-present", { id: presenter.id, name: presenter.name });
            }
        }

        // Gửi reactions hiện tại
        if (rooms[roomId].reactions.length > 0) {
            socket.emit("reactions", rooms[roomId].reactions);
        }

        console.log(`${name} (${isHost ? "Host" : "Guest"}) joined room ${roomId}`);
    });

    // ==================== SIGNALING WEBRTC ====================
    socket.on("signal", (data) => {
        io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
    });

    // ==================== MEDIA UPDATE (mic/cam) ====================
    socket.on("media-update", (data) => {
        const roomId = getUserRoom(socket.id);
        if (roomId) {
            socket.to(roomId).emit("media-update", { id: socket.id, ...data });
        }
    });

    // ==================== CHAT ====================
    socket.on("chat", ({ text }) => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);
        if (roomId && user) {
            io.to(roomId).emit("chat", { id: socket.id, name: user.name, text });
        }
    });

    // ==================== CHIA SẺ MÀN HÌNH (AI CŨNG ĐƯỢC) ====================
    socket.on("start-present", () => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);
        if (roomId && user) {
            rooms[roomId].presenter = socket.id;
            io.to(roomId).emit("start-present", { id: socket.id, name: user.name });
            console.log(`${user.name} đang chia sẻ màn hình trong ${roomId}`);
        }
    });

    socket.on("stop-present", () => {
        const roomId = getUserRoom(socket.id);
        if (roomId && rooms[roomId].presenter === socket.id) {
            rooms[roomId].presenter = null;
            io.to(roomId).emit("stop-present");
        }
    });

    // ==================== NÂNG TAY PHÁT BIỂU ====================
    socket.on("raise-hand", () => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);
        if (roomId && user) {
            user.raisedHand = true;
            io.to(roomId).emit("user-raised-hand", { id: socket.id, name: user.name });
        }
    });

    socket.on("lower-hand", () => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);
        if (roomId && user) {
            user.raisedHand = false;
            io.to(roomId).emit("user-lowered-hand", { id: socket.id });
        }
    });

    // ==================== PHẢN ỨNG CẢM XÚC ====================
    socket.on("reaction", (emoji) => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);
        if (roomId && user && emoji) {
            const reaction = { name: user.name, emoji, timestamp: Date.now() };
            rooms[roomId].reactions.push(reaction);

            // Chỉ giữ 10 reaction mới nhất
            if (rooms[roomId].reactions.length > 10) {
                rooms[roomId].reactions.shift();
            }

            io.to(roomId).emit("reactions", [reaction]); // Gửi từng cái để animate
        }
    });

    // ==================== HOST CONTROL: MUTE / KICK ====================
    socket.on("mute-user", ({ targetId }) => {
        const roomId = getUserRoom(socket.id);
        const host = findUser(socket.id);
        const target = findUser(targetId);
        if (roomId && host?.isHost && target) {
            io.to(targetId).emit("muted-by-host");
            socket.to(roomId).emit("user-muted", { id: targetId });
        }
    });

    socket.on("kick-user", ({ targetId }) => {
        const roomId = getUserRoom(socket.id);
        const host = findUser(socket.id);
        const target = findUser(targetId);
        if (roomId && host?.isHost && target) {
            io.to(targetId).emit("kicked-from-room");
            socket.to(targetId).disconnectSockets(); // Ngắt kết nối
            cleanupUser(targetId);
        }
    });

    // ==================== DISCONNECT ====================
    socket.on("disconnect", () => {
        const roomId = getUserRoom(socket.id);
        const user = findUser(socket.id);

        if (roomId && user) {
            console.log(`${user.name} left room ${roomId}`);

            // Nếu là presenter → dừng chia sẻ
            if (rooms[roomId].presenter === socket.id) {
                rooms[roomId].presenter = null;
                socket.to(roomId).emit("stop-present");
            }

            // Xóa người dùng
            rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);

            // Thông báo
            io.to(roomId).emit("user-left", { id: socket.id, name: user.name });

            // Nếu phòng trống → xóa phòng
            if (rooms[roomId].users.length === 0) {
                delete rooms[roomId];
                console.log(`Room ${roomId} đã bị xóa vì trống`);
            }
        }
    });
});

// ==================== HELPER FUNCTIONS ====================
function getUserRoom(id) {
    for (const roomId in rooms) {
        if (rooms[roomId].users.some(u => u.id === id)) {
            return roomId;
        }
    }
    return null;
}

function findUser(id) {
    for (const roomId in rooms) {
        const user = rooms[roomId].users.find(u => u.id === id);
        if (user) return user;
    }
    return null;
}

function cleanupUser(id) {
    const roomId = getUserRoom(id);
    if (roomId) {
        rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== id);
        if (rooms[roomId].users.length === 0) delete rooms[roomId];
    }
}

socket.on("mic-changed", data => {
    socket.to(data.room).emit("mic-changed", data);
});
socket.on("cam-changed", data => {
    socket.to(data.room).emit("cam-changed", data);
});
socket.on("hand-changed", data => {
    socket.to(data.room).emit("hand-changed", data);
});
socket.on("reaction", data => {
    socket.to(data.room).emit("reaction", data);
});



// ==================== START SERVER ====================
server.listen(PORT, () => {
    console.log(`Server đang chạy trên port ${PORT}`);
    console.log(`Google Meet clone - Đầy đủ chức năng!`);
});
