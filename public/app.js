const socket = io();

const state = {
  me: JSON.parse(localStorage.getItem("morimori-me") || "null"),
  users: [],
  activeUserId: null,
  messages: [],
  replyTo: null,
  notificationReady: false
};

const app = document.getElementById("app");


/* =========================
   共通
========================= */

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function initials(name) {
  return (
    String(name || "?")
      .trim()[0] || "?"
  ).toUpperCase();
}


function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}


/* =========================
   通知
========================= */

async function requestNotificationPermission() {

  if (!("Notification" in window)) {
    return false;
  }

  if (Notification.permission === "granted") {
    state.notificationReady = true;
    return true;
  }

  if (Notification.permission === "denied") {
    return false;
  }

  try {

    const permission =
      await Notification.requestPermission();

    state.notificationReady =
      permission === "granted";

    return state.notificationReady;

  } catch {

    return false;

  }
}


function showBrowserNotification(
  title,
  body
) {

  if (!("Notification" in window)) {
    return;
  }

  if (
    Notification.permission !==
    "granted"
  ) {
    return;
  }

  /*
   * ページが表示中でも通知を出す。
   * 後で設定から変更できるようにする。
   */

  try {

    const notification =
      new Notification(
        title,
        {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "morimori-message",
          renotify: true
        }
      );


    notification.onclick = () => {

      window.focus();

      notification.close();

    };


  } catch {

    /*
     * 一部ブラウザでは
     * Notificationコンストラクタが
     * 制限されるため無視。
     */

  }

}


function showNotice(text) {

  const old =
    document.querySelector(
      ".notice"
    );

  old?.remove();


  const element =
    document.createElement(
      "div"
    );

  element.className =
    "notice";

  element.textContent =
    text;


  document.body.appendChild(
    element
  );


  setTimeout(
    () => element.remove(),
    3500
  );

}


/* =========================
   ユーザー
========================= */

async function loadUsers() {

  const response =
    await fetch("/api/users");


  if (!response.ok) {
    throw new Error(
      "ユーザー情報を取得できませんでした。"
    );
  }


  state.users =
    await response.json();


  render();

}


async function loadMessages(
  otherUserId
) {

  const response =
    await fetch(
      `/api/messages/${encodeURIComponent(
        state.me.id
      )}/${encodeURIComponent(
        otherUserId
      )}`
    );


  if (!response.ok) {

    state.messages = [];

    render();

    return;
  }


  state.messages =
    await response.json();


  socket.emit(
    "mark-read",
    {
      otherUserId
    }
  );


  render();

}


/* =========================
   描画
========================= */

function render() {

  if (!state.me) {
    renderSetup();
    return;
  }

  renderApp();

}


/* =========================
   初期登録画面
========================= */

function renderSetup() {

  app.innerHTML = `
    <main class="screen">
      <section class="card">

        <div class="logo">
          mori<span>mori</span>
        </div>

        <p class="sub">
          学校でつながる、シンプルな連絡アプリ。
        </p>

        <form id="setup-form">

          <div class="field">
            <label for="name">
              名前
            </label>

            <input
              id="name"
              maxlength="40"
              autocomplete="name"
              placeholder="例：田中太郎"
              required
            >
          </div>

          <div class="field">
            <label for="className">
              クラス
            </label>

            <input
              id="className"
              maxlength="30"
              placeholder="例：1年3組"
              required
            >
          </div>

          <div
            id="setup-error"
            class="error"
          ></div>

          <button
            class="primary"
            type="submit"
          >
            morimoriを始める
          </button>

        </form>

      </section>
    </main>
  `;


  document
    .getElementById("setup-form")
    .addEventListener(
      "submit",
      async event => {

        event.preventDefault();


        const error =
          document.getElementById(
            "setup-error"
          );


        error.textContent = "";


        const name =
          document
            .getElementById("name")
            .value
            .trim();


        const className =
          document
            .getElementById("className")
            .value
            .trim();


        if (!name || !className) {

          error.textContent =
            "名前とクラスを入力してください。";

          return;
        }


        try {

          const response =
            await fetch(
              "/api/users",
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    name,
                    className
                  })
              }
            );


          const data =
            await response.json();


          if (!response.ok) {

            throw new Error(
              data.error ||
              "登録に失敗しました。"
            );

          }


          state.me = data;


          localStorage.setItem(
            "morimori-me",
            JSON.stringify(data)
          );


          socket.emit(
            "identify",
            state.me.id
          );


          /*
           * 通知許可を要求
           */

          await requestNotificationPermission();


          await loadUsers();


        } catch (errorObject) {

          error.textContent =
            errorObject.message ||
            "登録に失敗しました。";

        }

      }
    );

}


/* =========================
   アプリ
========================= */

function renderApp() {

  const others =
    state.users.filter(
      user =>
        user.id !== state.me.id
    );


  const active =
    state.users.find(
      user =>
        user.id ===
        state.activeUserId
    );


  app.innerHTML = `

    <div class="app-shell">

      <aside class="sidebar">

        <div class="side-top">

          <div class="logo">
            mori<span>mori</span>
          </div>

          <div class="me">

            <div class="avatar">
              ${esc(
                initials(
                  state.me.name
                )
              )}
            </div>

            <div>

              <div class="me-name">
                ${esc(
                  state.me.name
                )}
              </div>

              <div class="me-class">
                ${esc(
                  state.me.className
                )}
              </div>

            </div>

          </div>

        </div>


        <div class="user-list">

          ${
            others.length

              ? others
                  .map(userTemplate)
                  .join("")

              : `
                <div class="empty">
                  ほかのユーザーがまだいません。
                </div>
              `
          }

        </div>

      </aside>


      <main class="chat">

        <header class="chat-head">

          ${
            active

              ? `

                <div class="avatar">
                  ${esc(
                    initials(
                      active.name
                    )
                  )}
                </div>

                <div class="chat-title">

                  <strong>
                    ${esc(
                      active.name
                    )}
                  </strong>

                  <span class="${
                    active.online
                      ? "status online"
                      : "status"
                  }">

                    ${
                      active.online
                        ? "● オンライン"
                        : "○ オフライン"
                    }

                  </span>

                </div>

              `

              : `

                <div class="chat-title">

                  <strong>
                    チャット
                  </strong>

                  <span>
                    左から相手を選択してください
                  </span>

                </div>

              `
          }

        </header>


        <section
          class="messages"
          id="messages"
        >

          ${
            active

              ? (

                  state.messages.length

                    ? state.messages
                        .map(
                          messageTemplate
                        )
                        .join("")

                    : `
                      <div class="empty">
                        まだメッセージはありません。
                      </div>
                    `
                )

              : `

                <div class="empty">
                  ユーザーを選ぶとチャットを開始できます。
                </div>

              `
          }

        </section>


        ${
          state.replyTo

            ? `

              <div class="reply-bar">

                <div class="reply-text">

                  返信:
                  ${esc(
                    state.replyTo.text
                  )}

                </div>

                <button
                  class="icon-btn"
                  id="cancel-reply"
                  type="button"
                >
                  ×
                </button>

              </div>

            `

            : ""
        }


        <form
          class="composer"
          id="composer"
        >

          <textarea
            id="message-input"
            rows="1"
            placeholder="${
              active
                ? "メッセージを入力"
                : "相手を選択してください"
            }"
            ${active ? "" : "disabled"}
          ></textarea>


          <button
            class="send"
            type="submit"
            ${active ? "" : "disabled"}
          >
            送信
          </button>

        </form>

      </main>

    </div>

  `;


  /*
   * ユーザー選択
   */

  document
    .querySelectorAll(".user")
    .forEach(button => {

      button.addEventListener(
        "click",
        async () => {

          state.activeUserId =
            button.dataset.id;

          state.replyTo = null;

          await loadMessages(
            state.activeUserId
          );

        }
      );

    });


  /*
   * 入力
   */

  const input =
    document.getElementById(
      "message-input"
    );


  const composer =
    document.getElementById(
      "composer"
    );


  if (input) {

    input.addEventListener(
      "keydown",
      event => {

        /*
         * 日本語IME変換中のEnterは
         * 送信しない。
         */

        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing
        ) {

          event.preventDefault();

          composer.requestSubmit();

        }

      }
    );

  }


  /*
   * 送信
   */

  composer.addEventListener(
    "submit",
    event => {

      event.preventDefault();


      if (
        !state.activeUserId ||
        !input
      ) {
        return;
      }


      const text =
        input.value.trim();


      if (!text) {
        return;
      }


      socket.emit(
        "send-message",
        {
          to:
            state.activeUserId,

          text,

          replyTo:
            state.replyTo?.id ||
            null
        }
      );


      input.value = "";

      state.replyTo = null;


      render();


      document
        .getElementById(
          "message-input"
        )
        ?.focus();

    }
  );


  /*
   * 返信
   */

  document
    .querySelectorAll(
      "[data-reply]"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const message =
            state.messages.find(
              item =>
                item.id ===
                button.dataset.reply
            );


          if (!message) {
            return;
          }


          state.replyTo =
            message;


          render();


          document
            .getElementById(
              "message-input"
            )
            ?.focus();

        }
      );

    });


  /*
   * 返信キャンセル
   */

  document
    .getElementById(
      "cancel-reply"
    )
    ?.addEventListener(
      "click",
      () => {

        state.replyTo = null;

        render();

      }
    );


  /*
   * 最下部へ
   */

  const messagesElement =
    document.getElementById(
      "messages"
    );


  if (messagesElement) {

    messagesElement.scrollTop =
      messagesElement.scrollHeight;

  }

}


/* =========================
   ユーザー表示
========================= */

function userTemplate(user) {

  return `

    <button
      class="user ${
        user.id ===
        state.activeUserId
          ? "active"
          : ""
      }"
      data-id="${esc(user.id)}"
      type="button"
    >

      <div class="avatar">
        ${esc(
          initials(user.name)
        )}
      </div>


      <div class="user-meta">

        <div class="user-name">
          ${esc(user.name)}
        </div>

        <div class="user-class">
          ${esc(
            user.className
          )}
        </div>

      </div>


      <div class="${
        user.online
          ? "status online"
          : "status"
      }">

        ${
          user.online
            ? "●"
            : "○"
        }

      </div>

    </button>

  `;

}


/* =========================
   メッセージ表示
========================= */

function messageTemplate(
  message
) {

  const mine =
    message.from ===
    state.me.id;


  const reply =
    message.replyTo

      ? state.messages.find(
          item =>
            item.id ===
            message.replyTo
        )

      : null;


  return `

    <div class="bubble-row ${
      mine ? "mine" : ""
    }">

      <div class="bubble">

        ${
          reply

            ? `

              <div class="reply-ref">
                ${esc(
                  reply.text
                )}
              </div>

            `

            : ""
        }


        <div class="text">
          ${esc(
            message.text
          )}
        </div>


        <div class="meta">

          <span>
            ${formatTime(
              message.createdAt
            )}
          </span>


          ${
            mine

              ? `

                <span>
                  ${
                    message.read
                      ? "既読"
                      : "送信済み"
                  }
                </span>

              `

              : ""
          }


          <button
            class="icon-btn"
            data-reply="${esc(
              message.id
            )}"
            type="button"
            style="
              padding:2px 6px;
              font-size:10px;
            "
          >
            返信
          </button>

        </div>

      </div>

    </div>

  `;

}


/* =========================
   Socket接続
========================= */

socket.on(
  "connect",
  () => {

    if (state.me) {

      socket.emit(
        "identify",
        state.me.id
      );

    }

  }
);


/* =========================
   メッセージ受信
========================= */

socket.on(
  "message",
  message => {

    if (!state.me) {
      return;
    }


    const belongsToActive =
      state.activeUserId &&

      (

        (
          message.from ===
            state.me.id &&

          message.to ===
            state.activeUserId
        )

        ||

        (
          message.to ===
            state.me.id &&

          message.from ===
            state.activeUserId
        )

      );


    if (belongsToActive) {

      state.messages.push(
        message
      );


      if (
        message.to ===
        state.me.id
      ) {

        socket.emit(
          "mark-read",
          {
            otherUserId:
              state.activeUserId
          }
        );

      }

    }


    render();


    /*
     * 自分が開いていない
     * 相手からのメッセージ
     */

    if (
      message.to ===
        state.me.id &&

      message.from !==
        state.activeUserId
    ) {

      const sender =
        state.users.find(
          user =>
            user.id ===
            message.from
        );


      const senderName =
        sender?.name ||
        "新しいメッセージ";


      showNotice(
        `${senderName}: ${message.text}`
      );


      showBrowserNotification(
        senderName,
        message.text
      );

    }

  }
);


/* =========================
   返信通知
========================= */

socket.on(
  "reply-notification",
  data => {

    showNotice(
      `${data.from}から返信`
    );


    showBrowserNotification(
      `${data.from}から返信`,
      "あなたのメッセージに返信がありました。"
    );

  }
);


/* =========================
   オンライン状態
========================= */

socket.on(
  "presence",
  data => {

    const user =
      state.users.find(
        item =>
          item.id ===
          data.userId
      );


    if (!user) {
      return;
    }


    user.online =
      data.online;


    user.lastOnline =
      data.lastOnline;


    render();

  }
);


/* =========================
   既読
========================= */

socket.on(
  "messages-read",
  ({ otherUserId }) => {

    if (
      otherUserId !==
      state.activeUserId
    ) {
      return;
    }


    state.messages =
      state.messages.map(
        message => {

          if (
            message.from ===
            state.me.id
          ) {

            return {
              ...message,
              read: true
            };

          }


          return message;

        }
      );


    render();

  }
);


/* =========================
   起動
========================= */

(async function init() {

  if (state.me) {

    socket.emit(
      "identify",
      state.me.id
    );


    try {

      await loadUsers();


    } catch {

      render();

    }


  } else {

    render();

  }

})();
