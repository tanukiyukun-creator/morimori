const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(
  express.json({
    limit: "15mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

/* ==================================================
   データ
================================================== */

const users = new Map();
const messages = new Map();
const friendships = new Map();
const friendRequests = new Map();
const userSockets = new Map();

/*
  friendships:
  userId -> Map(
    otherUserId -> {
      favorite: false,
      createdAt: number
    }
  )

  friendRequests:
  requestId -> {
    id,
    from,
    to,
    status,
    createdAt
  }
*/

/* ==================================================
   共通
================================================== */

function createId() {
  return crypto.randomUUID();
}

function getUser(userId) {
  return users.get(userId) || null;
}

function isOnline(userId) {
  const sockets = userSockets.get(userId);

  return !!sockets && sockets.size > 0;
}

function getUserSockets(userId) {
  return userSockets.get(userId) || new Set();
}

function emitToUser(userId, event, data) {
  const sockets = getUserSockets(userId);

  for (const socketId of sockets) {
    io.to(socketId).emit(event, data);
  }
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

function conversationKey(userA, userB) {
  return [userA, userB]
    .sort()
    .join(":");
}

function getConversation(userA, userB) {
  const key = conversationKey(
    userA,
    userB
  );

  if (!messages.has(key)) {
    messages.set(key, []);
  }

  return messages.get(key);
}

function getFriendMap(userId) {
  if (!friendships.has(userId)) {
    friendships.set(
      userId,
      new Map()
    );
  }

  return friendships.get(userId);
}

function areFriends(userA, userB) {
  return (
    getFriendMap(userA).has(userB) &&
    getFriendMap(userB).has(userA)
  );
}

function addFriend(userA, userB) {
  const now = Date.now();

  getFriendMap(userA).set(
    userB,
    {
      favorite: false,
      createdAt: now
    }
  );

  getFriendMap(userB).set(
    userA,
    {
      favorite: false,
      createdAt: now
    }
  );
}

function removeFriend(userA, userB) {
  getFriendMap(userA).delete(userB);
  getFriendMap(userB).delete(userA);
}

function getFriendInfo(userA, userB) {
  return (
    getFriendMap(userA).get(userB) ||
    null
  );
}

function getLastMessage(userA, userB) {
  const conversation =
    getConversation(
      userA,
      userB
    );

  if (!conversation.length) {
    return null;
  }

  return conversation[
    conversation.length - 1
  ];
}

function getUnreadCount(
  userId,
  otherUserId
) {
  const conversation =
    getConversation(
      userId,
      otherUserId
    );

  return conversation.filter(
    message =>
      message.to === userId &&
      message.from === otherUserId &&
      !message.read &&
      !message.deleted
  ).length;
}

function friendObject(
  userId,
  otherUserId
) {
  const user =
    getUser(otherUserId);

  if (!user) {
    return null;
  }

  const info =
    getFriendInfo(
      userId,
      otherUserId
    );

  const lastMessage =
    getLastMessage(
      userId,
      otherUserId
    );

  return {
    ...publicUser(user),

    favorite:
      info?.favorite || false,

    friendSince:
      info?.createdAt || null,

    lastMessageAt:
      lastMessage?.createdAt || 0,

    lastMessageText:
      lastMessage?.deleted
        ? ""
        : lastMessage?.text || "",

    unread:
      getUnreadCount(
        userId,
        otherUserId
      )
  };
}

/* ==================================================
   Health
================================================== */

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "ok",
      app: "morimori"
    });
  }
);

/* ==================================================
   ユーザー
================================================== */

app.get(
  "/api/users",
  (req, res) => {
    const result = [];

    for (const user of users.values()) {
      result.push(
        publicUser(user)
      );
    }

    res.json(result);
  }
);

app.post(
  "/api/users",
  (req, res) => {
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
      createdAt: Date.now(),
      lastOnline: null
    };

    users.set(
      user.id,
      user
    );

    getFriendMap(user.id);

    res.status(201).json(
      publicUser(user)
    );
  }
);

app.get(
  "/api/users/:userId",
  (req, res) => {
    const user =
      getUser(req.params.userId);

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

/* ==================================================
   プロフィール更新
================================================== */

app.patch(
  "/api/users/:userId",
  (req, res) => {
    const userId =
      req.params.userId;

    const user =
      getUser(userId);

    if (!user) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
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
      typeof req.body?.icon === "string" ||
      req.body?.icon === null
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

    /*
      アイコンはデータURLを想定。
      あまりに巨大なデータを防止。
    */
    if (
      icon &&
      icon.length > 12_000_000
    ) {
      return res.status(400).json({
        error:
          "アイコン画像が大きすぎます。"
      });
    }

    user.name = name;
    user.className = className;
    user.icon = icon;

    const updated =
      publicUser(user);

    io.emit(
      "user-updated",
      updated
    );

    res.json(updated);
  }
);

/* ==================================================
   友達一覧
================================================== */

app.get(
  "/api/friends/:userId",
  (req, res) => {
    const userId =
      req.params.userId;

    if (!getUser(userId)) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    const friendMap =
      getFriendMap(userId);

    const result = [];

    for (const friendId of friendMap.keys()) {
      const friend =
        friendObject(
          userId,
          friendId
        );

      if (friend) {
        result.push(friend);
      }
    }

    /*
      お気に入りを最上段、
      その中でも最近のやりとり順。
    */
    result.sort(
      (a, b) => {
        if (
          a.favorite !==
          b.favorite
        ) {
          return a.favorite
            ? -1
            : 1;
        }

        return (
          (b.lastMessageAt || 0) -
          (a.lastMessageAt || 0)
        );
      }
    );

    res.json(result);
  }
);

/* ==================================================
   お気に入り
================================================== */

app.patch(
  "/api/friends/:userId/:friendId/favorite",
  (req, res) => {
    const userId =
      req.params.userId;

    const friendId =
      req.params.friendId;

    if (
      !getUser(userId) ||
      !getUser(friendId)
    ) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    if (
      !areFriends(
        userId,
        friendId
      )
    ) {
      return res.status(400).json({
        error:
          "友達ではありません。"
      });
    }

    const favorite =
      Boolean(
        req.body?.favorite
      );

    getFriendMap(
      userId
    ).get(friendId).favorite =
      favorite;

    /*
      相手側のお気に入りは
      自動では変更しない。
    */

    const result =
      friendObject(
        userId,
        friendId
      );

    emitToUser(
      userId,
      "favorite-updated",
      result
    );

    res.json(result);
  }
);

/* ==================================================
   友達削除
================================================== */

app.delete(
  "/api/friends/:userId/:friendId",
  (req, res) => {
    const userId =
      req.params.userId;

    const friendId =
      req.params.friendId;

    if (
      !getUser(userId) ||
      !getUser(friendId)
    ) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    removeFriend(
      userId,
      friendId
    );

    emitToUser(
      friendId,
      "friend-removed",
      {
        userId
      }
    );

    emitToUser(
      userId,
      "friend-removed",
      {
        userId: friendId
      }
    );

    res.json({
      ok: true
    });
  }
);

/* ==================================================
   友達申請
================================================== */

app.get(
  "/api/friend-requests/:userId",
  (req, res) => {
    const userId =
      req.params.userId;

    if (!getUser(userId)) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    const incoming = [];
    const outgoing = [];

    for (const request of friendRequests.values()) {
      if (
        request.status !==
        "pending"
      ) {
        continue;
      }

      if (request.to === userId) {
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

      if (request.from === userId) {
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

    incoming.sort(
      (a, b) =>
        b.createdAt -
        a.createdAt
    );

    outgoing.sort(
      (a, b) =>
        b.createdAt -
        a.createdAt
    );

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
      typeof req.body?.from === "string"
        ? req.body.from
        : "";

    const to =
      typeof req.body?.to === "string"
        ? req.body.to
        : "";

    if (
      !from ||
      !to ||
      !getUser(from) ||
      !getUser(to)
    ) {
      return res.status(400).json({
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
      areFriends(
        from,
        to
      )
    ) {
      return res.status(400).json({
        error:
          "すでに友達です。"
      });
    }

    for (const request of friendRequests.values()) {
      if (
        request.status ===
          "pending" &&
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
          error:
            "すでに申請されています。"
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

    const fromUser =
      publicUser(
        getUser(from)
      );

    emitToUser(
      to,
      "friend-request",
      {
        ...request,
        fromUser
      }
    );

    res.status(201).json({
      ...request,
      fromUser
    });
  }
);

/* ==================================================
   友達申請 処理
================================================== */

app.post(
  "/api/friend-requests/:requestId/:action",
  (req, res) => {
    const request =
      friendRequests.get(
        req.params.requestId
      );

    const action =
      req.params.action;

    if (!request) {
      return res.status(404).json({
        error:
          "申請が見つかりません。"
      });
    }

    if (
      request.status !==
      "pending"
    ) {
      return res.status(400).json({
        error:
          "この申請はすでに処理されています。"
      });
    }

    if (
      action !== "accept" &&
      action !== "reject"
    ) {
      return res.status(400).json({
        error:
          "不正な操作です。"
      });
    }

    if (action === "reject") {
      request.status =
        "rejected";

      emitToUser(
        request.from,
        "friend-request-rejected",
        {
          requestId:
            request.id
        }
      );

      return res.json({
        ok: true,
        status: "rejected"
      });
    }

    request.status =
      "accepted";

    addFriend(
      request.from,
      request.to
    );

    const fromUser =
      publicUser(
        getUser(
          request.from
        )
      );

    const toUser =
      publicUser(
        getUser(
          request.to
        )
      );

    emitToUser(
      request.from,
      "friend-added",
      {
        user: toUser
      }
    );

    emitToUser(
      request.to,
      "friend-added",
      {
        user: fromUser
      }
    );

    res.json({
      ok: true,
      status: "accepted"
    });
  }
);

/* ==================================================
   メッセージ取得
================================================== */

app.get(
  "/api/messages/:userId/:otherUserId",
  (req, res) => {
    const userId =
      req.params.userId;

    const otherUserId =
      req.params.otherUserId;

    if (!getUser(userId)) {
      return res.status(404).json({
        error:
          "ユーザーが見つかりません。"
      });
    }

    if (!getUser(otherUserId)) {
      return res.status(404).json({
        error:
          "相手のユーザーが見つかりません。"
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

/* ==================================================
   メッセージ削除
================================================== */

app.delete(
  "/api/messages/:userId/:messageId",
  (req, res) => {
    const userId =
      req.params.userId;

    const messageId =
      req.params.messageId;

    let found = null;

    for (const conversation of messages.values()) {
      const message =
        conversation.find(
          item =>
            item.id ===
            messageId
        );

      if (message) {
        found = message;
        break;
      }
    }

    if (!found) {
      return res.status(404).json({
        error:
          "メッセージが見つかりません。"
      });
    }

    if (
      found.from !== userId
    ) {
      return res.status(403).json({
        error:
          "このメッセージは削除できません。"
      });
    }

    found.deleted = true;
    found.text = "";

    emitToUser(
      found.from,
      "message-deleted",
      {
        messageId
      }
    );

    emitToUser(
      found.to,
      "message-deleted",
      {
        messageId
      }
    );

    res.json({
      ok: true
    });
  }
);

/* ==================================================
   Socket.IO
================================================== */

io.on(
  "connection",
  socket => {

    socket.on(
      "identify",
      userId => {
        if (
          typeof userId !==
            "string" ||
          !users.has(userId)
        ) {
          return;
        }

        if (
          socket.data.userId
        ) {
          removeSocketFromUser(
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

    /* ==============================
       メッセージ送信
    ============================== */

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

        if (
          !to ||
          !text.trim()
        ) {
          return;
        }

        if (
          text.length > 10000
        ) {
          return;
        }

        if (
          !users.has(from) ||
          !users.has(to)
        ) {
          return;
        }

        if (from === to) {
          return;
        }

        /*
          友達以外とのチャットを
          防止。
        */
        if (
          !areFriends(
            from,
            to
          )
        ) {
          return;
        }

        let validReplyTo =
          null;

        if (replyTo) {
          const conversation =
            getConversation(
              from,
              to
            );

          const original =
            conversation.find(
              message =>
                message.id ===
                replyTo
            );

          if (original) {
            validReplyTo =
              replyTo;
          }
        }

        const message = {
          id: createId(),
          from,
          to,
          text,
          replyTo:
            validReplyTo,
          createdAt:
            Date.now(),
          read: false,
          deleted: false
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

        /*
          相手への通知
        */
        const sender =
          getUser(from);

        emitToUser(
          to,
          "new-message-notification",
          {
            from:
              publicUser(
                sender
              ),
            message
          }
        );

        /*
          返信通知
        */
        if (
          validReplyTo
        ) {
          const original =
            conversation.find(
              item =>
                item.id ===
                validReplyTo
            );

          if (
            original &&
            original.from !== from
          ) {
            emitToUser(
              original.from,
              "reply-notification",
              {
                from:
                  sender?.name ||
                  "ユーザー",
                messageId:
                  message.id,
                replyTo:
                  validReplyTo
              }
            );
          }
        }
      }
    );

    /* ==============================
       既読
    ============================== */

    socket.on(
      "mark-read",
      data => {
        const userId =
          socket.data.userId;

        if (!userId) {
          return;
        }

        const otherUserId =
          typeof data?.otherUserId ===
          "string"
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

        for (
          const message of conversation
        ) {
          if (
            message.to ===
              userId &&
            message.from ===
              otherUserId &&
            !message.read
          ) {
            message.read =
              true;

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
    );

    /* ==============================
       切断
    ============================== */

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
  }
);

/* ==================================================
   オンライン状態
================================================== */

function removeSocketFromUser(
  socket,
  userId
) {
  const sockets =
    userSockets.get(
      userId
    );

  if (!sockets) {
    return;
  }

  sockets.delete(
    socket.id
  );

  if (sockets.size > 0) {
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

/* ==================================================
   SPA
================================================== */

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

/* ==================================================
   起動
================================================== */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `morimori server running on port ${PORT}`
    );
  }
);
