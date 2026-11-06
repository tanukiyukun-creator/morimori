const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));

app.use(express.static(path.join(__dirname, "public")));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

/*
  =========================
  データ
  =========================
*/

const users = new Map();
const messages = new Map();
const friendRequests = new Map();
const friendships = new Map();
const userSockets = new Map();

/*
  users
  user = {
    id,
    name,
    className,
    icon,
    createdAt,
    lastOnline,
    favorites: Set()
  }
*/

/*
  friendRequests
  key = requestId
  {
    id,
    from,
    to,
    status,
    createdAt
  }
*/

/*
  friendships
  key = userA:userB
  true
*/

/*
  messages
  key = sorted user IDs
  [
    {
      id,
      from,
      to,
      text,
      replyTo,
      createdAt,
      read,
      deleted
    }
  ]
*/

/*
  =========================
  共通関数
  =========================
*/

function createId() {
  return crypto.randomUUID();
}

function getUser(userId) {
  return users.get(userId) || null;
}

function conversationKey(a, b) {
  return [a, b].sort().join(":");
}

function getConversation(a, b) {
  const key = conversationKey(a, b);

  if (!messages.has(key)) {
    messages.set(key, []);
  }

  return messages.get(key);
}

function isOnline(userId) {
  const sockets = userSockets.get(userId);

  return !!sockets && sockets.size > 0;
}

function publicUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    className: user.className,
    icon: user.icon || null,
    online: isOnline(user.id),
    lastOnline: user.lastOnline || null
  };
}

function getFriendKey(a, b) {
  return [a, b].sort().join(":");
}

function areFriends(a, b) {
  return friendships.has(getFriendKey(a, b));
}

function getFriends(userId) {
  const result = [];

  for (const friend of users.values()) {
    if (friend.id === userId) {
      continue;
    }

    if (areFriends(userId, friend.id)) {
      result.push(friend);
    }
  }

  return result;
}

function emitToUser(userId, event, data) {
  const sockets = userSockets.get(userId);

  if (!sockets) {
    return;
  }

  for (const socketId of sockets) {
    io.to(socketId).emit(event, data);
  }
}

function emitPresence(userId) {
  const user = getUser(userId);

  if (!user) {
    return;
  }

  io.emit("presence", {
    userId,
    online: isOnline(userId),
    lastOnline: user.lastOnline || null
  });
}

function unreadCount(userId, otherUserId) {
  const conversation =
    getConversation(userId, otherUserId);

  return conversation.filter(message =>
    message.to === userId &&
    message.from === otherUserId &&
    !message.read &&
    !message.deleted
  ).length;
}

function lastMessage(userId, otherUserId) {
  const conversation =
    getConversation(userId, otherUserId);

  if (!conversation.length) {
    return null;
  }

  return conversation[conversation.length - 1];
}

/*
  =========================
  Health
  =========================
*/

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "morimori"
  });
});

/*
  =========================
  ユーザー
  =========================
*/

app.get("/api/users", (req, res) => {
  const result = [];

  for (const user of users.values()) {
    result.push(publicUser(user));
  }

  res.json(result);
});

app.post("/api/users", (req, res) => {
  const name =
    typeof req.body?.name === "string"
      ? req.body.name.trim()
      : "";

  const className =
    typeof req.body?.className === "string"
      ? req.body.className.trim()
      : "";

  if (!name || !className) {
    return res.status(400).json({
      error: "名前とクラスを入力してください。"
    });
  }

  if (name.length > 40) {
    return res.status(400).json({
      error: "名前は40文字以内にしてください。"
    });
  }

  if (className.length > 30) {
    return res.status(400).json({
      error: "クラスは30文字以内にしてください。"
    });
  }

  const user = {
    id: createId(),
    name,
    className,
    icon: null,
    createdAt: Date.now(),
    lastOnline: null
  };

  users.set(user.id, user);

  res.status(201).json(publicUser(user));
});

app.get("/api/users/:userId", (req, res) => {
  const user = getUser(req.params.userId);

  if (!user) {
    return res.status(404).json({
      error: "ユーザーが見つかりません。"
    });
  }

  res.json(publicUser(user));
});

app.patch("/api/users/:userId", (req, res) => {
  const user = getUser(req.params.userId);

  if (!user) {
    return res.status(404).json({
      error: "ユーザーが見つかりません。"
    });
  }

  const name =
    typeof req.body?.name === "string"
      ? req.body.name.trim()
      : user.name;

  const className =
    typeof req.body?.className === "string"
      ? req.body.className.trim()
      : user.className;

  const icon =
    typeof req.body?.icon === "string"
      ? req.body.icon
      : user.icon;

  if (!name || !className) {
    return res.status(400).json({
      error: "名前とクラスを入力してください。"
    });
  }

  if (name.length > 40) {
    return res.status(400).json({
      error: "名前は40文字以内にしてください。"
    });
  }

  if (className.length > 30) {
    return res.status(400).json({
      error: "クラスは30文字以内にしてください。"
    });
  }

  user.name = name;
  user.className = className;
  user.icon = icon || null;

  const updated = publicUser(user);

  io.emit("user-updated", updated);

  res.json(updated);
});

/*
  =========================
  友達
  =========================
*/

app.get("/api/friends/:userId", (req, res) => {
  const userId = req.params.userId;

  if (!users.has(userId)) {
    return res.status(404).json({
      error: "ユーザーが見つかりません。"
    });
  }

  const friends = getFriends(userId).map(friend => {
    const last = lastMessage(userId, friend.id);

    return {
      ...publicUser(friend),
      favorite: false,
      unread: unreadCount(userId, friend.id),
      lastMessageAt: last?.createdAt || 0
    };
  });

  const currentUser = getUser(userId);

  for (const friend of friends) {
    friend.favorite =
      !!currentUser?.favorites?.has(friend.id);
  }

  friends.sort((a, b) => {
    if (a.favorite !== b.favorite) {
      return a.favorite ? -1 : 1;
    }

    return b.lastMessageAt - a.lastMessageAt;
  });

  res.json(friends);
});

/*
  友達申請一覧
*/

app.get("/api/friend-requests/:userId", (req, res) => {
  const userId = req.params.userId;

  const incoming = [];
  const outgoing = [];

  for (const request of friendRequests.values()) {
    if (
      request.to === userId &&
      request.status === "pending"
    ) {
      incoming.push({
        ...request,
        fromUser: publicUser(
          getUser(request.from)
        )
      });
    }

    if (
      request.from === userId &&
      request.status === "pending"
    ) {
      outgoing.push({
        ...request,
        toUser: publicUser(
          getUser(request.to)
        )
      });
    }
  }

  res.json({
    incoming,
    outgoing
  });
});

/*
  友達申請
*/

app.post("/api/friend-requests", (req, res) => {
  const from =
    typeof req.body?.from === "string"
      ? req.body.from
      : "";

  const to =
    typeof req.body?.to === "string"
      ? req.body.to
      : "";

  if (!users.has(from) || !users.has(to)) {
    return res.status(404).json({
      error: "ユーザーが見つかりません。"
    });
  }

  if (from === to) {
    return res.status(400).json({
      error: "自分自身には申請できません。"
    });
  }

  if (areFriends(from, to)) {
    return res.status(400).json({
      error: "すでに友達です。"
    });
  }

  for (const request of friendRequests.values()) {
    if (
      request.status === "pending" &&
      (
        (
          request.from === from &&
          request.to === to
        ) ||
        (
          request.from === to &&
          request.to === from
        )
      )
    ) {
      return res.status(400).json({
        error: "すでに友達申請があります。"
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
      fromUser: publicUser(
        getUser(from)
      )
    }
  );

  res.status(201).json(request);
});

/*
  友達申請承認
*/

app.post(
  "/api/friend-requests/:requestId/accept",
  (req, res) => {
    const request =
      friendRequests.get(
        req.params.requestId
      );

    if (!request) {
      return res.status(404).json({
        error: "申請が見つかりません。"
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "この申請は処理済みです。"
      });
    }

    request.status = "accepted";

    friendships.set(
      getFriendKey(
        request.from,
        request.to
      ),
      true
    );

    emitToUser(
      request.from,
      "friend-added",
      {
        user: publicUser(
          getUser(request.to)
        )
      }
    );

    emitToUser(
      request.to,
      "friend-added",
      {
        user: publicUser(
          getUser(request.from)
        )
      }
    );

    res.json({
      ok: true
    });
  }
);

/*
  友達申請拒否
*/

app.post(
  "/api/friend-requests/:requestId/reject",
  (req, res) => {
    const request =
      friendRequests.get(
        req.params.requestId
      );

    if (!request) {
      return res.status(404).json({
        error: "申請が見つかりません。"
      });
    }

    request.status = "rejected";

    res.json({
      ok: true
    });
  }
);

/*
  友達削除
*/

app.delete(
  "/api/friends/:userId/:friendId",
  (req, res) => {
    const key =
      getFriendKey(
        req.params.userId,
        req.params.friendId
      );

    friendships.delete(key);

    const user =
      getUser(req.params.userId);

    if (user?.favorites) {
      user.favorites.delete(
        req.params.friendId
      );
    }

    emitToUser(
      req.params.friendId,
      "friend-removed",
      {
        userId: req.params.userId
      }
    );

    res.json({
      ok: true
    });
  }
);

/*
  =========================
  お気に入り
  =========================
*/

app.post(
  "/api/favorites/:userId/:friendId",
  (req, res) => {
    const user =
      getUser(req.params.userId);

    const friend =
      getUser(req.params.friendId);

    if (!user || !friend) {
      return res.status(404).json({
        error: "ユーザーが見つかりません。"
      });
    }

    if (!areFriends(user.id, friend.id)) {
      return res.status(400).json({
        error: "友達ではありません。"
      });
    }

    if (!user.favorites) {
      user.favorites = new Set();
    }

    user.favorites.add(friend.id);

    res.json({
      ok: true,
      favorite: true
    });
  }
);

app.delete(
  "/api/favorites/:userId/:friendId",
  (req, res) => {
    const user =
      getUser(req.params.userId);

    if (!user) {
      return res.status(404).json({
        error: "ユーザーが見つかりません。"
      });
    }

    if (user.favorites) {
      user.favorites.delete(
        req.params.friendId
      );
    }

    res.json({
      ok: true,
      favorite: false
    });
  }
);

/*
  =========================
  チャット
  =========================
*/

app.get(
  "/api/messages/:userId/:otherUserId",
  (req, res) => {
    const userId =
      req.params.userId;

    const otherUserId =
      req.params.otherUserId;

    if (!users.has(userId)) {
      return res.status(404).json({
        error: "ユーザーが見つかりません。"
      });
    }

    if (!users.has(otherUserId)) {
      return res.status(404).json({
        error: "相手のユーザーが見つかりません。"
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

    const messageId =
      req.params.messageId;

    for (const conversation of messages.values()) {
      const message =
        conversation.find(
          item => item.id === messageId
        );

      if (!message) {
        continue;
      }

      if (
        message.from !== userId &&
        message.to !== userId
      ) {
        return res.status(403).json({
          error: "削除できません。"
        });
      }

      message.deleted = true;
      message.text = "";

      io.emit(
        "message-deleted",
        {
          messageId
        }
      );

      return res.json({
        ok: true
      });
    }

    res.status(404).json({
      error: "メッセージが見つかりません。"
    });
  }
);

/*
  =========================
  Socket.IO
  =========================
*/

io.on("connection", socket => {

  /*
    ログイン
  */

  socket.on("identify", userId => {
    if (
      typeof userId !== "string" ||
      !users.has(userId)
    ) {
      return;
    }

    if (socket.data.userId) {
      removeSocketFromUser(
        socket,
        socket.data.userId
      );
    }

    socket.data.userId = userId;

    if (!userSockets.has(userId)) {
      userSockets.set(
        userId,
        new Set()
      );
    }

    userSockets
      .get(userId)
      .add(socket.id);

    const user = getUser(userId);

    if (user) {
      user.lastOnline = null;
    }

    emitPresence(userId);
  });

  /*
    メッセージ送信
  */

  socket.on(
    "send-message",
    data => {
      const from =
        socket.data.userId;

      if (!from) {
        return;
      }

      const to =
        typeof data?.to === "string"
          ? data.to
          : "";

      const text =
        typeof data?.text === "string"
          ? data.text
          : "";

      const replyTo =
        typeof data?.replyTo === "string"
          ? data.replyTo
          : null;

      if (!to || !text.trim()) {
        return;
      }

      if (
        !users.has(from) ||
        !users.has(to) ||
        from === to
      ) {
        return;
      }

      if (text.length > 10000) {
        return;
      }

      let validReplyTo = null;

      if (replyTo) {
        const conversation =
          getConversation(
            from,
            to
          );

        if (
          conversation.some(
            message =>
              message.id === replyTo
          )
        ) {
          validReplyTo = replyTo;
        }
      }

      const message = {
        id: createId(),
        from,
        to,
        text,
        replyTo: validReplyTo,
        createdAt: Date.now(),
        read: false,
        deleted: false
      };

      const conversation =
        getConversation(
          from,
          to
        );

      conversation.push(message);

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
          from: publicUser(
            getUser(from)
          ),
          message
        }
      );

      if (validReplyTo) {
        emitToUser(
          to,
          "reply-notification",
          {
            from: getUser(from)?.name ||
              "ユーザー",
            messageId: message.id,
            replyTo: validReplyTo
          }
        );
      }
    }
  );

  /*
    既読
  */

  socket.on(
    "mark-read",
    data => {
      const userId =
        socket.data.userId;

      if (!userId) {
        return;
      }

      const otherUserId =
        typeof data?.otherUserId === "string"
          ? data.otherUserId
          : "";

      if (!otherUserId) {
        return;
      }

      const conversation =
        getConversation(
          userId,
          otherUserId
        );

      let changed = false;

      for (const message of conversation) {
        if (
          message.to === userId &&
          message.from === otherUserId &&
          !message.read
        ) {
          message.read = true;
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      emitToUser(
        otherUserId,
        "messages-read",
        {
          otherUserId: userId
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
  );

  /*
    切断
  */

  socket.on(
    "disconnect",
    () => {
      const userId =
        socket.data.userId;

      if (!userId) {
        return;
      }

      removeSocketFromUser(
        socket,
        userId
      );
    }
  );
});

/*
  =========================
  オンライン管理
  =========================
*/

function removeSocketFromUser(
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

  if (sockets.size > 0) {
    return;
  }

  userSockets.delete(userId);

  const user =
    getUser(userId);

  const lastOnline =
    Date.now();

  if (user) {
    user.lastOnline =
      lastOnline;
  }

  emitPresence(userId);
}

/*
  =========================
  SPA fallback
  =========================
*/

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

/*
  =========================
  起動
  =========================
*/

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `morimori server running on port ${PORT}`
    );
  }
);
