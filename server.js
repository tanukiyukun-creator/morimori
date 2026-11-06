const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));

app.use(express.static(
  path.join(__dirname, "public")
));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

/* =========================
   データ
========================= */

const users = new Map();
const messages = new Map();
const userSockets = new Map();
const friendRequests = new Map();
const friendships = new Map();

/* =========================
   共通
========================= */

function createId() {
  return crypto.randomUUID();
}

function getUser(id) {
  return users.get(id) || null;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    className: user.className,
    icon: user.icon || null,
    online: isOnline(user.id),
    lastOnline: user.lastOnline || null
  };
}

function isOnline(userId) {
  const sockets =
    userSockets.get(userId);

  return !!sockets &&
    sockets.size > 0;
}

function emitToUser(
  userId,
  event,
  data
) {
  const sockets =
    userSockets.get(userId);

  if (!sockets) return;

  for (const socketId of sockets) {
    io.to(socketId).emit(
      event,
      data
    );
  }
}

function conversationKey(a, b) {
  return [a, b]
    .sort()
    .join(":");
}

function getConversation(a, b) {
  const key =
    conversationKey(a, b);

  if (!messages.has(key)) {
    messages.set(key, []);
  }

  return messages.get(key);
}

function friendshipKey(a, b) {
  return [a, b]
    .sort()
    .join(":");
}

function areFriends(a, b) {
  return friendships.has(
    friendshipKey(a, b)
  );
}

function getFriendList(userId) {
  const result = [];

  for (const key of friendships.keys()) {
    const ids = key.split(":");

    if (!ids.includes(userId)) {
      continue;
    }

    const otherId =
      ids[0] === userId
        ? ids[1]
        : ids[0];

    const user =
      getUser(otherId);

    if (!user) continue;

    const conversation =
      getConversation(
        userId,
        otherId
      );

    const last =
      conversation[
        conversation.length - 1
      ];

    const unread =
      conversation.filter(
        message =>
          message.to === userId &&
          message.from === otherId &&
          !message.read
      ).length;

    result.push({
      ...publicUser(user),
      favorite:
        user.favoriteFor?.includes(
          userId
        ) || false,
      lastMessageAt:
        last?.createdAt || null,
      lastMessageText:
        last?.deleted
          ? "削除されたメッセージ"
          : last?.text || null,
      unread
    });
  }

  result.sort(
    (a, b) => {
      if (
        a.favorite &&
        !b.favorite
      ) return -1;

      if (
        !a.favorite &&
        b.favorite
      ) return 1;

      return (
        (b.lastMessageAt || 0) -
        (a.lastMessageAt || 0)
      );
    }
  );

  return result;
}

/* =========================
   Health
========================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "ok",
      app: "morimori"
    });
  }
);

/* =========================
   Users
========================= */

app.get(
  "/api/users",
  (req, res) => {
    res.json(
      [...users.values()]
        .map(publicUser)
    );
  }
);

app.post(
  "/api/users",
  (req, res) => {
    const name =
      typeof req.body?.name ===
      "string"
        ? req.body.name.trim()
        : "";

    const className =
      typeof req.body?.className ===
      "string"
        ? req.body.className.trim()
        : "";

    if (!name || !className) {
      return res.status(400).json({
        error:
          "名前とクラスを入力してください。"
      });
    }

    if (name.length > 40) {
      return res.status(400).json({
        error:
          "名前は40文字以内にしてください。"
      });
    }

    if (className.length > 30) {
      return res.status(400).json({
        error:
          "クラスは30文字以内にしてください。"
      });
    }

    const user = {
      id: createId(),
      name,
      className,
      icon: null,
      favoriteFor: [],
      createdAt: Date.now(),
      lastOnline: null
    };

    users.set(
      user.id,
      user
    );

    res.status(201).json(
      publicUser(user)
    );
  }
);

app.get(
  "/api/users/:userId",
  (req, res) => {
    const user =
      getUser(
        req.params.userId
      );

    if (!user) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    res.json(
      publicUser(user)
    );
  }
);

app.patch(
  "/api/users/:userId",
  (req, res) => {
    const user =
      getUser(
        req.params.userId
      );

    if (!user) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    const name =
      typeof req.body?.name ===
      "string"
        ? req.body.name.trim()
        : user.name;

    const className =
      typeof req.body?.className ===
      "string"
        ? req.body.className.trim()
        : user.className;

    const icon =
      typeof req.body?.icon ===
      "string"
        ? req.body.icon
        : user.icon;

    if (!name || !className) {
      return res.status(400).json({
        error:
          "名前とクラスを入力してください。"
      });
    }

    if (name.length > 40) {
      return res.status(400).json({
        error:
          "名前は40文字以内にしてください。"
      });
    }

    if (className.length > 30) {
      return res.status(400).json({
        error:
          "クラスは30文字以内にしてください。"
      });
    }

    user.name = name;
    user.className = className;
    user.icon = icon || null;

    const updated =
      publicUser(user);

    io.emit(
      "user-updated",
      updated
    );

    res.json(updated);
  }
);

/* =========================
   Friends
========================= */

app.get(
  "/api/friends/:userId",
  (req, res) => {
    const userId =
      req.params.userId;

    if (!users.has(userId)) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    res.json(
      getFriendList(userId)
    );
  }
);

/* =========================
   Friend requests
========================= */

app.get(
  "/api/friend-requests/:userId",
  (req, res) => {
    const userId =
      req.params.userId;

    const incoming = [];
    const outgoing = [];

    for (const request of friendRequests.values()) {
      if (
        request.to === userId &&
        request.status === "pending"
      ) {
        incoming.push({
          ...request,
          fromUser:
            publicUser(
              getUser(
                request.from
              )
            )
        });
      }

      if (
        request.from === userId &&
        request.status === "pending"
      ) {
        outgoing.push({
          ...request,
          toUser:
            publicUser(
              getUser(
                request.to
              )
            )
        });
      }
    }

    res.json({
      incoming,
      outgoing
    });
  }
);

app.post(
  "/api/friend-requests",
  (req, res) => {
    const from =
      req.body?.from;

    const to =
      req.body?.to;

    if (
      !users.has(from) ||
      !users.has(to)
    ) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    if (from === to) {
      return res.status(400).json({
        error:
          "自分自身には申請できません。"
      });
    }

    if (
      areFriends(from, to)
    ) {
      return res.status(400).json({
        error:
          "すでに友達です。"
      });
    }

    for (
      const request
      of friendRequests.values()
    ) {
      if (
        request.from === from &&
        request.to === to &&
        request.status === "pending"
      ) {
        return res.status(400).json({
          error:
            "すでに申請しています。"
        });
      }
    }

    const request = {
      id: createId(),
      from,
      to,
      status: "pending",
      createdAt: Date.now()
    };

    friendRequests.set(
      request.id,
      request
    );

    emitToUser(
      to,
      "friend-request",
      {
        ...request,
        fromUser:
          publicUser(
            getUser(from)
          )
      }
    );

    res.status(201).json(
      request
    );
  }
);

app.post(
  "/api/friend-requests/:requestId/accept",
  (req, res) => {
    const request =
      friendRequests.get(
        req.params.requestId
      );

    if (!request) {
      return res.status(404).json({
        error:
          "申請が見つかりません。"
      });
    }

    request.status =
      "accepted";

    friendships.set(
      friendshipKey(
        request.from,
        request.to
      ),
      {
        createdAt: Date.now()
      }
    );

    const fromUser =
      getUser(request.from);

    const toUser =
      getUser(request.to);

    emitToUser(
      request.from,
      "friend-added",
      {
        user:
          publicUser(toUser)
      }
    );

    emitToUser(
      request.to,
      "friend-added",
      {
        user:
          publicUser(fromUser)
      }
    );

    res.json({
      ok: true
    });
  }
);

app.post(
  "/api/friend-requests/:requestId/reject",
  (req, res) => {
    const request =
      friendRequests.get(
        req.params.requestId
      );

    if (!request) {
      return res.status(404).json({
        error:
          "申請が見つかりません。"
      });
    }

    request.status =
      "rejected";

    res.json({
      ok: true
    });
  }
);

/* =========================
   Messages
========================= */

app.get(
  "/api/messages/:userId/:otherUserId",
  (req, res) => {
    const {
      userId,
      otherUserId
    } = req.params;

    if (
      !users.has(userId) ||
      !users.has(otherUserId)
    ) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    res.json(
      getConversation(
        userId,
        otherUserId
      )
    );
  }
);

app.delete(
  "/api/messages/:userId/:messageId",
  (req, res) => {
    const userId =
      req.params.userId;

    let target = null;

    for (
      const conversation
      of messages.values()
    ) {
      const found =
        conversation.find(
          message =>
            message.id ===
            req.params.messageId
        );

      if (found) {
        target = found;
        break;
      }
    }

    if (!target) {
      return res.status(404).json({
        error:
          "メッセージが見つかりません。"
      });
    }

    if (
      target.from !== userId
    ) {
      return res.status(403).json({
        error:
          "削除できません。"
      });
    }

    target.deleted = true;
    target.text = "";

    io.emit(
      "message-deleted",
      {
        messageId:
          target.id
      }
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   WebRTC
========================= */

io.on(
  "connection",
  socket => {

    socket.on(
      "identify",
      userId => {
        if (
          !users.has(userId)
        ) {
          return;
        }

        if (
          socket.data.userId
        ) {
          removeSocket(
            socket,
            socket.data.userId
          );
        }

        socket.data.userId =
          userId;

        if (
          !userSockets.has(
            userId
          )
        ) {
          userSockets.set(
            userId,
            new Set()
          );
        }

        userSockets
          .get(userId)
          .add(socket.id);

        const user =
          getUser(userId);

        if (user) {
          user.lastOnline =
            null;
        }

        io.emit(
          "presence",
          {
            userId,
            online: true,
            lastOnline: null
          }
        );
      }
    );

    /* -------------------------
       Message
    ------------------------- */

    socket.on(
      "send-message",
      data => {
        const from =
          socket.data.userId;

        if (!from) return;

        const to =
          typeof data?.to ===
          "string"
            ? data.to
            : "";

        const text =
          typeof data?.text ===
          "string"
            ? data.text
            : "";

        if (
          !to ||
          !text.trim()
        ) {
          return;
        }

        if (
          !users.has(to)
        ) {
          return;
        }

        if (
          !areFriends(from, to)
        ) {
          return;
        }

        const message = {
          id: createId(),
          from,
          to,
          text: text.trim(),
          replyTo:
            data?.replyTo ||
            null,
          createdAt:
            Date.now(),
          read: false
        };

        const conversation =
          getConversation(
            from,
            to
          );

        conversation.push(
          message
        );

        emitToUser(
          from,
          "message",
          message
        );

        emitToUser(
          to,
          "message",
          message
        );

        emitToUser(
          to,
          "new-message-notification",
          {
            from:
              publicUser(
                getUser(from)
              ),
            message
          }
        );
      }
    );

    /* -------------------------
       Read
    ------------------------- */

    socket.on(
      "mark-read",
      data => {
        const userId =
          socket.data.userId;

        const otherUserId =
          data?.otherUserId;

        if (
          !userId ||
          !otherUserId
        ) {
          return;
        }

        const conversation =
          getConversation(
            userId,
            otherUserId
          );

        let changed = false;

        for (
          const message
          of conversation
        ) {
          if (
            message.to ===
              userId &&
            message.from ===
              otherUserId &&
            !message.read
          ) {
            message.read = true;
            changed = true;
          }
        }

        if (changed) {
          emitToUser(
            otherUserId,
            "messages-read",
            {
              otherUserId:
                userId
            }
          );

          emitToUser(
            userId,
            "messages-read",
            {
              otherUserId
            }
          );
        }
      }
    );

    /* =====================
       WebRTC signaling
    ===================== */

    socket.on(
      "call-user",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (
          !from ||
          !to ||
          !users.has(to)
        ) {
          return;
        }

        if (
          !areFriends(
            from,
            to
          )
        ) {
          return;
        }

        emitToUser(
          to,
          "incoming-call",
          {
            from,
            fromUser:
              publicUser(
                getUser(from)
              ),
            callType:
              data.callType ===
              "video"
                ? "video"
                : "audio"
          }
        );
      }
    );

    socket.on(
      "call-accepted",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        emitToUser(
          to,
          "call-accepted",
          {
            from
          }
        );
      }
    );

    socket.on(
      "call-rejected",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        emitToUser(
          to,
          "call-rejected",
          {
            from
          }
        );
      }
    );

    socket.on(
      "call-ended",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        emitToUser(
          to,
          "call-ended",
          {
            from
          }
        );
      }
    );

    socket.on(
      "webrtc-offer",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (
          !from ||
          !to ||
          !data?.offer
        ) {
          return;
        }

        emitToUser(
          to,
          "webrtc-offer",
          {
            from,
            offer:
              data.offer
          }
        );
      }
    );

    socket.on(
      "webrtc-answer",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (
          !from ||
          !to ||
          !data?.answer
        ) {
          return;
        }

        emitToUser(
          to,
          "webrtc-answer",
          {
            from,
            answer:
              data.answer
          }
        );
      }
    );

    socket.on(
      "webrtc-ice",
      data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (
          !from ||
          !to ||
          !data?.candidate
        ) {
          return;
        }

        emitToUser(
          to,
          "webrtc-ice",
          {
            from,
            candidate:
              data.candidate
          }
        );
      }
    );

    socket.on(
      "disconnect",
      () => {
        const userId =
          socket.data.userId;

        if (userId) {
          removeSocket(
            socket,
            userId
          );
        }
      }
    );
  }
);

/* =========================
   Socket cleanup
========================= */

function removeSocket(
  socket,
  userId
) {
  const sockets =
    userSockets.get(userId);

  if (!sockets) {
    return;
  }

  sockets.delete(
    socket.id
  );

  if (
    sockets.size > 0
  ) {
    return;
  }

  userSockets.delete(
    userId
  );

  const user =
    getUser(userId);

  const lastOnline =
    Date.now();

  if (user) {
    user.lastOnline =
      lastOnline;
  }

  io.emit(
    "presence",
    {
      userId,
      online: false,
      lastOnline
    }
  );
}

/* =========================
   SPA
========================= */

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `morimori running on ${PORT}`
    );
  }
);
