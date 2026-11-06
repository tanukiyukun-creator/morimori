const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const users = new Map();
const messages = new Map();
const sockets = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function id() {
  return crypto.randomUUID();
}

function roomFor(a, b) {
  return [a, b].sort().join(":");
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "SCHOOL LINK" }));

app.post("/api/users", (req, res) => {
  const name = String(req.body.name || "").trim();
  const className = String(req.body.className || "").trim();

  if (!name || !className) {
    return res.status(400).json({ error: "名前とクラスを入力してください。" });
  }

  const user = {
    id: id(),
    name: name.slice(0, 40),
    className: className.slice(0, 30),
    icon: "",
    createdAt: Date.now()
  };

  users.set(user.id, user);
  res.json(user);
});

app.get("/api/users", (_req, res) => {
  res.json([...users.values()].map(u => ({
    ...u,
    online: sockets.has(u.id)
  })));
});

app.get("/api/messages/:a/:b", (req, res) => {
  const room = roomFor(req.params.a, req.params.b);
  res.json(messages.get(room) || []);
});

io.on("connection", socket => {
  socket.on("identify", userId => {
    if (!users.has(userId)) return;
    sockets.set(userId, socket.id);
    socket.data.userId = userId;
    io.emit("presence", { userId, online: true });
  });

  socket.on("send-message", payload => {
    const from = users.get(socket.data.userId);
    const to = users.get(payload.to);

    if (!from || !to) return;

    const text = String(payload.text || "").trim();
    if (!text) return;

    const message = {
      id: id(),
      roomId: roomFor(from.id, to.id),
      from: from.id,
      to: to.id,
      text: text.slice(0, 5000),
      replyTo: payload.replyTo || null,
      createdAt: Date.now(),
      read: false
    };

    const room = message.roomId;
    if (!messages.has(room)) messages.set(room, []);
    messages.get(room).push(message);

    io.to(socket.id).emit("message", message);

    const targetSocket = sockets.get(to.id);
    if (targetSocket) {
      io.to(targetSocket).emit("message", message);
      if (message.replyTo) {
        io.to(targetSocket).emit("reply-notification", {
          from: from.name,
          messageId: message.id,
          replyTo: message.replyTo
        });
      }
    }
  });

  socket.on("mark-read", ({ messageIds, otherUserId }) => {
    const me = socket.data.userId;
    if (!me || !Array.isArray(messageIds)) return;

    const room = roomFor(me, otherUserId);
    const list = messages.get(room) || [];
    const ids = new Set(messageIds);

    for (const m of list) {
      if (ids.has(m.id) && m.to === me) m.read = true;
    }

    const otherSocket = sockets.get(otherUserId);
    if (otherSocket) {
      io.to(otherSocket).emit("messages-read", { messageIds });
    }
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;
    if (!userId) return;
    if (sockets.get(userId) === socket.id) {
      sockets.delete(userId);
      io.emit("presence", { userId, online: false });
    }
  });
});

app.get("*splat", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`SCHOOL LINK running on http://localhost:${PORT}`);
});