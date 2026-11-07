const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

/* ==================================================
   PostgreSQL
================================================== */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が設定されていません。");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* ==================================================
   Express
================================================== */

app.use(express.json({
  limit: "20mb"
}));

app.use(express.static(
  path.join(__dirname, "public")
));

/* ==================================================
   Socket.IO
================================================== */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: [
      "GET",
      "POST",
      "PATCH",
      "DELETE"
    ]
  }
});

/* ==================================================
   メモリ上の接続情報
   ※ユーザーデータ自体はDB
================================================== */

const userSockets = new Map();

/* ==================================================
   共通
================================================== */

function createId() {
  return crypto.randomUUID();
}

function isOnline(userId) {
  const sockets = userSockets.get(userId);

  return !!sockets && sockets.size > 0;
}

async function getUser(id) {
  const result = await pool.query(
    `
    SELECT
      id,
      name,
      class_name,
      icon,
      created_at,
      last_online
    FROM users
    WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    className: user.class_name,
    icon: user.icon || null,
    online: isOnline(user.id),
    lastOnline: user.last_online || null
  };
}

async function areFriends(a, b) {
  const result = await pool.query(
    `
    SELECT 1
    FROM friendships
    WHERE user_a = $1
      AND user_b = $2
    LIMIT 1
    `,
    normalizePair(a, b)
  );

  return result.rowCount > 0;
}

function normalizePair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function emitToUser(userId, event, data) {
  const sockets = userSockets.get(userId);

  if (!sockets) return;

  for (const socketId of sockets) {
    io.to(socketId).emit(event, data);
  }
}

/* ==================================================
   DB初期化
================================================== */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      icon TEXT,
      favorite_for TEXT[] NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL,
      last_online BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_a, user_b)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      reply_to TEXT,
      created_at BIGINT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      deleted BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON messages(sender_id, receiver_id, created_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS friend_requests_to_idx
    ON friend_requests(to_user, status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS friend_requests_from_idx
    ON friend_requests(from_user, status)
  `);

  console.log("PostgreSQL database initialized.");
}

/* ==================================================
   Health
================================================== */

app.get(
  "/health",
  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      res.json({
        status: "ok",
        app: "morimori",
        database: "connected"
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        status: "error",
        app: "morimori",
        database: "error"
      });
    }
  }
);

/* ==================================================
   Users
================================================== */

app.get(
  "/api/users",
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          id,
          name,
          class_name,
          icon,
          created_at,
          last_online
        FROM users
        ORDER BY name ASC
      `);

      res.json(
        result.rows.map(publicUser)
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "ユーザー一覧を取得できません。"
      });
    }
  }
);

app.post(
  "/api/users",
  async (req, res) => {
    try {
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
        class_name: className,
        icon: null,
        created_at: Date.now(),
        last_online: null
      };

      await pool.query(
        `
        INSERT INTO users (
          id,
          name,
          class_name,
          icon,
          created_at,
          last_online
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          user.id,
          user.name,
          user.class_name,
          user.icon,
          user.created_at,
          user.last_online
        ]
      );

      res.status(201).json(
        publicUser(user)
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "アカウントを作成できません。"
      });
    }
  }
);

app.get(
  "/api/users/:userId",
  async (req, res) => {
    try {
      const user =
        await getUser(req.params.userId);

      if (!user) {
        return res.status(404).json({
          error: "ユーザーが見つかりません。"
        });
      }

      res.json(
        publicUser(user)
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "ユーザーを取得できません。"
      });
    }
  }
);

app.patch(
  "/api/users/:userId",
  async (req, res) => {
    try {
      const user =
        await getUser(req.params.userId);

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
          : user.class_name;

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

      await pool.query(
        `
        UPDATE users
        SET
          name = $1,
          class_name = $2,
          icon = $3
        WHERE id = $4
        `,
        [
          name,
          className,
          icon || null,
          user.id
        ]
      );

      const updated =
        await getUser(user.id);

      const result =
        publicUser(updated);

      io.emit(
        "user-updated",
        result
      );

      res.json(result);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "プロフィールを更新できません。"
      });
    }
  }
);

/* ==================================================
   Favorite
================================================== */

app.post(
  "/api/favorites",
  async (req, res) => {
    try {
      const {
        userId,
        friendId
      } = req.body || {};

      if (!userId || !friendId) {
        return res.status(400).json({
          error: "ユーザー情報が不足しています。"
        });
      }

      if (
        !(await getUser(userId)) ||
        !(await getUser(friendId))
      ) {
        return res.status(404).json({
          error: "ユーザーが見つかりません。"
        });
      }

      if (!(await areFriends(userId, friendId))) {
        return res.status(403).json({
          error: "友達ではありません。"
        });
      }

      const result = await pool.query(
        `
        SELECT favorite_for
        FROM users
        WHERE id = $1
        `,
        [friendId]
      );

      const favorites =
        result.rows[0]?.favorite_for || [];

      const exists =
        favorites.includes(userId);

      const updatedFavorites =
        exists
          ? favorites.filter(id => id !== userId)
          : [...favorites, userId];

      await pool.query(
        `
        UPDATE users
        SET favorite_for = $1
        WHERE id = $2
        `,
        [
          updatedFavorites,
          friendId
        ]
      );

      res.json({
        ok: true,
        favorite: !exists
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "お気に入りを更新できません。"
      });
    }
  }
);

/* ==================================================
   Friends
================================================== */

app.get(
  "/api/friends/:userId",
  async (req, res) => {
    try {
      const userId =
        req.params.userId;

      if (!(await getUser(userId))) {
        return res.status(404).json({
          error: "ユーザーが見つかりません。"
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            CASE
              WHEN f.user_a = $1 THEN f.user_b
              ELSE f.user_a
            END AS other_id
          FROM friendships f
          WHERE f.user_a = $1
             OR f.user_b = $1
          `,
          [userId]
        );

      const friends = [];

      for (const row of result.rows) {
        const other =
          await getUser(row.other_id);

        if (!other) continue;

        const pair =
          normalizePair(
            userId,
            other.id
          );

        const messagesResult =
          await pool.query(
            `
            SELECT
              id,
              sender_id,
              receiver_id,
              text,
              reply_to,
              created_at,
              read,
              deleted
            FROM messages
            WHERE
              sender_id = $1
              AND receiver_id = $2
              OR
              sender_id = $2
              AND receiver_id = $1
            ORDER BY created_at ASC
            `,
            pair
          );

        const conversation =
          messagesResult.rows;

        const last =
          conversation[
            conversation.length - 1
          ];

        const unread =
          conversation.filter(
            message =>
              message.receiver_id === userId &&
              message.sender_id === other.id &&
              !message.read
          ).length;

        const favoriteResult =
          await pool.query(
            `
            SELECT $1 = ANY(favorite_for) AS favorite
            FROM users
            WHERE id = $2
            `,
            [
              userId,
              other.id
            ]
          );

        const favorite =
          favoriteResult.rows[0]?.favorite ||
          false;

        friends.push({
          ...publicUser(other),

          favorite,

          lastMessageAt:
            last?.created_at || null,

          lastMessageText:
            last?.deleted
              ? "削除されたメッセージ"
              : last?.text || null,

          unread
        });
      }

      friends.sort(
        (a, b) => {
          if (
            a.favorite &&
            !b.favorite
          ) {
            return -1;
          }

          if (
            !a.favorite &&
            b.favorite
          ) {
            return 1;
          }

          return (
            Number(b.lastMessageAt || 0) -
            Number(a.lastMessageAt || 0)
          );
        }
      );

      res.json(friends);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "友達一覧を取得できません。"
      });
    }
  }
);

/* ==================================================
   Friend Requests
================================================== */

app.get(
  "/api/friend-requests/:userId",
  async (req, res) => {
    try {
      const userId =
        req.params.userId;

      const incomingResult =
        await pool.query(
          `
          SELECT
            id,
            from_user,
            to_user,
            status,
            created_at
          FROM friend_requests
          WHERE to_user = $1
            AND status = 'pending'
          ORDER BY created_at DESC
          `,
          [userId]
        );

      const outgoingResult =
        await pool.query(
          `
          SELECT
            id,
            from_user,
            to_user,
            status,
            created_at
          FROM friend_requests
          WHERE from_user = $1
            AND status = 'pending'
          ORDER BY created_at DESC
          `,
          [userId]
        );

      const incoming = [];

      for (const request of incomingResult.rows) {
        const fromUser =
          await getUser(
            request.from_user
          );

        incoming.push({
          id: request.id,
          from: request.from_user,
          to: request.to_user,
          status: request.status,
          createdAt: Number(request.created_at),
          fromUser:
            publicUser(fromUser)
        });
      }

      const outgoing = [];

      for (const request of outgoingResult.rows) {
        const toUser =
          await getUser(
            request.to_user
          );

        outgoing.push({
          id: request.id,
          from: request.from_user,
          to: request.to_user,
          status: request.status,
          createdAt: Number(request.created_at),
          toUser:
            publicUser(toUser)
        });
      }

      res.json({
        incoming,
        outgoing
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "友達申請を取得できません。"
      });
    }
  }
);

app.post(
  "/api/friend-requests",
  async (req, res) => {
    try {
      const from =
        req.body?.from;

      const to =
        req.body?.to;

      if (
        !from ||
        !to
      ) {
        return res.status(400).json({
          error: "ユーザー情報が不足しています。"
        });
      }

      if (
        !(await getUser(from)) ||
        !(await getUser(to))
      ) {
        return res.status(404).json({
          error: "ユーザーが見つかりません。"
        });
      }

      if (from === to) {
        return res.status(400).json({
          error: "自分自身には申請できません。"
        });
      }

      if (await areFriends(from, to)) {
        return res.status(400).json({
          error: "すでに友達です。"
        });
      }

      const existing =
        await pool.query(
          `
          SELECT id
          FROM friend_requests
          WHERE from_user = $1
            AND to_user = $2
            AND status = 'pending'
          LIMIT 1
          `,
          [
            from,
            to
          ]
        );

      if (existing.rowCount > 0) {
        return res.status(400).json({
          error: "すでに申請しています。"
        });
      }

      const request = {
        id: createId(),
        from,
        to,
        status: "pending",
        createdAt: Date.now()
      };

      await pool.query(
        `
        INSERT INTO friend_requests (
          id,
          from_user,
          to_user,
          status,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          request.id,
          from,
          to,
          request.status,
          request.createdAt
        ]
      );

      const fromUser =
        await getUser(from);

      await emitToUser(
        to,
        "friend-request",
        {
          ...request,
          fromUser:
            publicUser(fromUser)
        }
      );

      res.status(201).json(request);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "友達申請を送信できません。"
      });
    }
  }
);

app.post(
  "/api/friend-requests/:requestId/accept",
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const requestResult =
        await client.query(
          `
          SELECT
            id,
            from_user,
            to_user,
            status
          FROM friend_requests
          WHERE id = $1
          FOR UPDATE
          `,
          [req.params.requestId]
        );

      const request =
        requestResult.rows[0];

      if (!request) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "申請が見つかりません。"
        });
      }

      if (request.status !== "pending") {
        await client.query("ROLLBACK");

        return res.status(400).json({
          error: "この申請はすでに処理されています。"
        });
      }

      const [
        userA,
        userB
      ] = normalizePair(
        request.from_user,
        request.to_user
      );

      await client.query(
        `
        UPDATE friend_requests
        SET status = 'accepted'
        WHERE id = $1
        `,
        [request.id]
      );

      await client.query(
        `
        INSERT INTO friendships (
          user_a,
          user_b,
          created_at
        )
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        `,
        [
          userA,
          userB,
          Date.now()
        ]
      );

      await client.query("COMMIT");

      const fromUser =
        await getUser(request.from_user);

      const toUser =
        await getUser(request.to_user);

      await emitToUser(
        request.from_user,
        "friend-added",
        {
          user:
            publicUser(toUser)
        }
      );

      await emitToUser(
        request.to_user,
        "friend-added",
        {
          user:
            publicUser(fromUser)
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      await client.query("ROLLBACK");

      console.error(error);

      res.status(500).json({
        error: "友達申請を承認できません。"
      });
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/friend-requests/:requestId/reject",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE friend_requests
          SET status = 'rejected'
          WHERE id = $1
            AND status = 'pending'
          RETURNING id
          `,
          [req.params.requestId]
        );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "申請が見つかりません。"
        });
      }

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "友達申請を拒否できません。"
      });
    }
  }
);

/* ==================================================
   Messages
================================================== */

app.get(
  "/api/messages/:userId/:otherUserId",
  async (req, res) => {
    try {
      const {
        userId,
        otherUserId
      } = req.params;

      if (
        !(await getUser(userId)) ||
        !(await getUser(otherUserId))
      ) {
        return res.status(404).json({
          error: "ユーザーが見つかりません。"
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            sender_id AS "from",
            receiver_id AS "to",
            text,
            reply_to AS "replyTo",
            created_at AS "createdAt",
            read,
            deleted
          FROM messages
          WHERE
            (
              sender_id = $1
              AND receiver_id = $2
            )
            OR
            (
              sender_id = $2
              AND receiver_id = $1
            )
          ORDER BY created_at ASC
          `,
          [
            userId,
            otherUserId
          ]
        );

      res.json(
        result.rows.map(message => ({
          ...message,
          createdAt:
            Number(message.createdAt)
        }))
      );
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "メッセージを取得できません。"
      });
    }
  }
);

app.delete(
  "/api/messages/:userId/:messageId",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          UPDATE messages
          SET
            deleted = TRUE,
            text = ''
          WHERE id = $1
            AND sender_id = $2
          RETURNING
            id,
            sender_id,
            receiver_id
          `,
          [
            req.params.messageId,
            req.params.userId
          ]
        );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "メッセージが見つかりません。"
        });
      }

      const message =
        result.rows[0];

      io.emit(
        "message-deleted",
        {
          messageId:
            message.id
        }
      );

      res.json({
        ok: true
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: "メッセージを削除できません。"
      });
    }
  }
);

/* ==================================================
   Socket.IO
================================================== */

io.on(
  "connection",
  socket => {

    /* ------------------------------------------
       Identify
    ------------------------------------------ */

    socket.on(
      "identify",
      async userId => {
        try {
          if (!(await getUser(userId))) {
            return;
          }

          if (socket.data.userId) {
            removeSocket(
              socket,
              socket.data.userId
            );
          }

          socket.data.userId =
            userId;

          if (!userSockets.has(userId)) {
            userSockets.set(
              userId,
              new Set()
            );
          }

          userSockets
            .get(userId)
            .add(socket.id);

          await pool.query(
            `
            UPDATE users
            SET last_online = NULL
            WHERE id = $1
            `,
            [userId]
          );

          io.emit(
            "presence",
            {
              userId,
              online: true,
              lastOnline: null
            }
          );
        } catch (error) {
          console.error(error);
        }
      }
    );

    /* ------------------------------------------
       Message
    ------------------------------------------ */

    socket.on(
      "send-message",
      async data => {
        try {
          const from =
            socket.data.userId;

          if (!from) return;

          const to =
            typeof data?.to === "string"
              ? data.to
              : "";

          const text =
            typeof data?.text === "string"
              ? data.text
              : "";

          if (
            !to ||
            !text.trim()
          ) {
            return;
          }

          if (!(await getUser(to))) {
            return;
          }

          if (!(await areFriends(from, to))) {
            return;
          }

          const message = {
            id: createId(),
            from,
            to,
            text: text.trim(),
            replyTo:
              data?.replyTo || null,
            createdAt: Date.now(),
            read: false,
            deleted: false
          };

          await pool.query(
            `
            INSERT INTO messages (
              id,
              sender_id,
              receiver_id,
              text,
              reply_to,
              created_at,
              read,
              deleted
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8
            )
            `,
            [
              message.id,
              message.from,
              message.to,
              message.text,
              message.replyTo,
              message.createdAt,
              false,
              false
            ]
          );

          await emitToUser(
            from,
            "message",
            message
          );

          await emitToUser(
            to,
            "message",
            message
          );

          const fromUser =
            await getUser(from);

          await emitToUser(
            to,
            "new-message-notification",
            {
              from:
                publicUser(fromUser),
              message
            }
          );
        } catch (error) {
          console.error(error);
        }
      }
    );

    /* ------------------------------------------
       Read
    ------------------------------------------ */

    socket.on(
      "mark-read",
      async data => {
        try {
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

          const result =
            await pool.query(
              `
              UPDATE messages
              SET read = TRUE
              WHERE
                receiver_id = $1
                AND sender_id = $2
                AND read = FALSE
              `,
              [
                userId,
                otherUserId
              ]
            );

          if (result.rowCount > 0) {
            await emitToUser(
              otherUserId,
              "messages-read",
              {
                otherUserId:
                  userId
              }
            );

            await emitToUser(
              userId,
              "messages-read",
              {
                otherUserId
              }
            );
          }
        } catch (error) {
          console.error(error);
        }
      }
    );

    /* ------------------------------------------
       WebRTC
    ------------------------------------------ */

    socket.on(
      "call-user",
      async data => {
        try {
          const from =
            socket.data.userId;

          const to =
            data?.to;

          if (
            !from ||
            !to ||
            !(await getUser(to))
          ) {
            return;
          }

          if (!(await areFriends(from, to))) {
            return;
          }

          const fromUser =
            await getUser(from);

          await emitToUser(
            to,
            "incoming-call",
            {
              from,
              fromUser:
                publicUser(fromUser),
              callType:
                data.callType === "video"
                  ? "video"
                  : "audio"
            }
          );
        } catch (error) {
          console.error(error);
        }
      }
    );

    socket.on(
      "call-accepted",
      async data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (!from || !to) return;

        await emitToUser(
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
      async data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (!from || !to) return;

        await emitToUser(
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
      async data => {
        const from =
          socket.data.userId;

        const to =
          data?.to;

        if (!from || !to) return;

        await emitToUser(
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
      async data => {
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

        await emitToUser(
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
      async data => {
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

        await emitToUser(
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
      async data => {
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

        await emitToUser(
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

    /* ------------------------------------------
       Disconnect
    ------------------------------------------ */

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

/* ==================================================
   Socket cleanup
================================================== */

async function removeSocket(
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

  userSockets.delete(
    userId
  );

  const lastOnline =
    Date.now();

  try {
    await pool.query(
      `
      UPDATE users
      SET last_online = $1
      WHERE id = $2
      `,
      [
        lastOnline,
        userId
      ]
    );
  } catch (error) {
    console.error(error);
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
   SPA fallback
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

async function start() {
  try {
    await initDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `morimori running on ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "Database initialization failed:",
      error
    );

    process.exit(1);
  }
}

start();
