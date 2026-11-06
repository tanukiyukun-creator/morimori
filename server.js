const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 10000;
const HOST = "0.0.0.0";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const users = new Map();
const messages = new Map();
const sockets = new Map();

const makeId = () => crypto.randomUUID();

function roomFor(a, b) {
  return [a, b].sort().join(":");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    className: user.className,
    icon: user.icon || "",
    online: sockets.has(user.id),
    lastOnline: user.lastOnline || null
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "morimori" });
});

app.get("/api/users", (_req, res) => {
  res.json([...users.values()].map(publicUser));
});

app.post("/api/users", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const className = String(req.body?.className || "").trim();

  if (!name || !className) {
    return res.status(400).json({ error: "名前とクラスを入力してください。" });
  }

  const user = {
    id: makeId(),
    name: name.slice(0, 40),
    className: className.slice(0, 30),
    icon: "",
    createdAt: Date.now(),
    lastOnline: null
  };

  users.set(user.id, user);
  res.json(publicUser(user));
});

app.get("/api/messages/:a/:b", (req, res) => {
  const room = roomFor(req.params.a, req.params.b);
  res.json(messages.get(room) || []);
});

io.on("connection", (socket) => {
  socket.on("identify", (userId) => {
    const user = users.get(userId);
    if (!user) return;

    sockets.set(userId, socket.id);
    socket.data.userId = userId;

    io.emit("presence", {
      userId,
      online: true,
      lastOnline: null
    });
  });

  socket.on("send-message", (payload) => {
    const from = users.get(socket.data.userId);
    const to = users.get(String(payload?.to || ""));
    if (!from || !to || from.id === to.id) return;

    const text = String(payload?.text || "").trim();
    if (!text) return;

    let replyTo = null;
    if (payload?.replyTo) {
      replyTo = String(payload.replyTo);
    }

    const message = {
      id: makeId(),
      roomId: roomFor(from.id, to.id),
      from: from.id,
      to: to.id,
      text: text.slice(0, 5000),
      replyTo,
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

      if (replyTo) {
        io.to(targetSocket).emit("reply-notification", {
          from: from.name,
          messageId: message.id,
          replyTo
        });
      }
    }
  });

  socket.on("mark-read", ({ otherUserId }) => {
    const me = users.get(socket.data.userId);
    const other = users.get(String(otherUserId || ""));
    if (!me || !other) return;

    const room = roomFor(me.id, other.id);
    const list = messages.get(room) || [];
    let changed = false;

    for (const message of list) {
      if (message.to === me.id && !message.read) {
        message.read = true;
        changed = true;
      }
    }

    if (changed) {
      io.to(socket.id).emit("messages-read", { otherUserId: other.id });
      const otherSocket = sockets.get(other.id);
      if (otherSocket) {
        io.to(otherSocket).emit("messages-read", { otherUserId: me.id });
      }
    }
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;
    if (!userId) return;

    if (sockets.get(userId) === socket.id) {
      sockets.delete(userId);
      const user = users.get(userId);
      if (user) user.lastOnline = Date.now();

      io.emit("presence", {
        userId,
        online: false,
        lastOnline: user?.lastOnline || Date.now()
      });
    }
  });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/socket.io/") || req.path.startsWith("/api/")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, HOST, () => {
  console.log(`morimori listening on http://${HOST}:${PORT}`);
});