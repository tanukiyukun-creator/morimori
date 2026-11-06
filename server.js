const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;


/*
 * =========================
 * Express
 * =========================
 */

app.use(express.json({ limit: "10mb" }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/*
 * =========================
 * Socket.IO
 * =========================
 */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});


/*
 * =========================
 * データ
 *
 * 現在はMVPなのでメモリ保存。
 * Renderを再起動すると消える。
 * 後でデータベースへ変更する。
 * =========================
 */

const users = new Map();
const messages = new Map();


// userId -> Set(socketId)
const userSockets = new Map();


/*
 * =========================
 * 共通関数
 * =========================
 */

function createId() {
  return crypto.randomUUID();
}


function getUser(userId) {
  return users.get(userId) || null;
}


function getUserSockets(userId) {
  return userSockets.get(userId) || new Set();
}


function isOnline(userId) {
  const sockets = userSockets.get(userId);

  return !!sockets && sockets.size > 0;
}


function publicUser(user) {
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
  const key = conversationKey(userA, userB);

  if (!messages.has(key)) {
    messages.set(key, []);
  }

  return messages.get(key);
}


function emitToUser(userId, event, data) {
  const sockets = getUserSockets(userId);

  for (const socketId of sockets) {
    io.to(socketId).emit(event, data);
  }
}


/*
 * =========================
 * API
 * =========================
 */


/*
 * ヘルスチェック
 */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "morimori"
  });
});


/*
 * ユーザー一覧
 */

app.get("/api/users", (req, res) => {

  const result = [];

  for (const user of users.values()) {
    result.push(
      publicUser(user)
    );
  }

  res.json(result);
});


/*
 * ユーザー登録
 */

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


  users.set(
    user.id,
    user
  );


  res.status(201).json(
    publicUser(user)
  );
});


/*
 * ユーザー情報
 */

app.get("/api/users/:userId", (req, res) => {

  const user =
    getUser(req.params.userId);

  if (!user) {
    return res.status(404).json({
      error: "ユーザーが見つかりません。"
    });
  }

  res.json(
    publicUser(user)
  );
});


/*
 * 1対1メッセージ取得
 */

app.get(
  "/api/messages/:userId/:otherUserId",
  (req, res) => {

    const userId =
      req.params.userId;

    const otherUserId =
      req.params.otherUserId;


    if (!getUser(userId)) {
      return res.status(404).json({
        error: "ユーザーが見つかりません。"
      });
    }


    if (!getUser(otherUserId)) {
      return res.status(404).json({
        error: "相手のユーザーが見つかりません。"
      });
    }


    const conversation =
      getConversation(
        userId,
        otherUserId
      );


    res.json(conversation);
  }
);


/*
 * =========================
 * Socket.IO
 * =========================
 */

io.on("connection", socket => {

  /*
   * ユーザー識別
   */

  socket.on(
    "identify",
    userId => {

      if (
        typeof userId !== "string" ||
        !users.has(userId)
      ) {
        return;
      }


      /*
       * 以前のユーザー情報を解除
       */

      if (socket.data.userId) {

        removeSocketFromUser(
          socket,
          socket.data.userId
        );

      }


      socket.data.userId =
        userId;


      /*
       * Socketをユーザーに登録
       */

      if (!userSockets.has(userId)) {
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
        user.lastOnline = null;
      }


      /*
       * オンライン状態を全員へ通知
       */

      io.emit("presence", {
        userId,
        online: true,
        lastOnline: null
      });

    }
  );


  /*
   * メッセージ送信
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
          ? data.text.trim()
          : "";


      const replyTo =
        typeof data?.replyTo === "string"
          ? data.replyTo
          : null;


      /*
       * 基本チェック
       */

      if (!to || !text) {
        return;
      }


      if (text.length > 10000) {
        return;
      }


      if (!users.has(from)) {
        return;
      }


      if (!users.has(to)) {
        return;
      }


      if (from === to) {
        return;
      }


      /*
       * 返信先確認
       */

      let validReplyTo = null;

      if (replyTo) {

        const conversation =
          getConversation(
            from,
            to
          );


        const original =
          conversation.find(
            message =>
              message.id === replyTo
          );


        if (original) {
          validReplyTo = replyTo;
        }

      }


      /*
       * メッセージ作成
       */

      const message = {

        id: createId(),

        from,

        to,

        text,

        replyTo:
          validReplyTo,

        createdAt:
          Date.now(),

        read: false

      };


      /*
       * 保存
       */

      const conversation =
        getConversation(
          from,
          to
        );


      conversation.push(
        message
      );


      /*
       * 送信者へ
       */

      emitToUser(
        from,
        "message",
        message
      );


      /*
       * 受信者へ
       */

      emitToUser(
        to,
        "message",
        message
      );


      /*
       * 返信通知
       */

      if (validReplyTo) {

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

          const sender =
            getUser(from);


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


  /*
   * 既読
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


      /*
       * 自分宛ての未読を既読にする
       */

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


      /*
       * 相手側へ既読通知
       *
       * 相手から見ると
       * otherUserId = 自分
       */

      emitToUser(
        otherUserId,
        "messages-read",
        {
          otherUserId: userId
        }
      );


      /*
       * 自分側にも反映
       */

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
   * 切断
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
 * =========================
 * Socket解除
 * =========================
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


  /*
   * まだ別端末・別タブが
   * 接続している場合は
   * オフラインにしない
   */

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


  /*
   * オフライン通知
   */

  io.emit(
    "presence",
    {
      userId,
      online: false,
      lastOnline
    }
  );

}


/*
 * =========================
 * SPA fallback
 *
 * Express 5では "*" ではなく
 * "/{*splat}" を使用する。
 * =========================
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
 * =========================
 * 起動
 * =========================
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
