const socket = io();

const app = document.getElementById("app");

const STORAGE_KEY = "morimori-me";

let me = null;
let friends = [];
let allUsers = [];
let incomingRequests = [];
let outgoingRequests = [];

let currentChatUser = null;
let currentMessages = [];
let replyTarget = null;

let currentPage = "friends";
let searchTimer = null;

/* ==================================================
   WebRTC
================================================== */

let peerConnection = null;
let localStream = null;
let currentCall = null;
let pendingIceCandidates = [];
let callBusy = false;

const RTC_CONFIG = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302"
    },
    {
      urls: "stun:stun1.l.google.com:19302"
    }
  ]
};

/* ==================================================
   共通
================================================== */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);
  const now = new Date();

  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return date.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric"
  });
}

function avatarHtml(user, large = false) {
  const sizeClass = large ? " large" : "";

  if (user?.icon) {
    return `
      <div class="avatar${sizeClass}">
        <img src="${user.icon}" alt="">
      </div>
    `;
  }

  const first =
    user?.name?.trim()?.charAt(0) ||
    "?";

  return `
    <div class="avatar${sizeClass}">
      ${escapeHtml(first)}
    </div>
  `;
}

function showToast(message) {
  let toast = document.querySelector(".toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toast._timer);

  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      "通信に失敗しました。"
    );
  }

  return data;
}

/* ==================================================
   起動
================================================== */

async function init() {
  injectCallStyles();

  const saved =
    localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    renderSetup();
    return;
  }

  try {
    me = JSON.parse(saved);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    renderSetup();
    return;
  }

  try {
    const fresh =
      await api(`/api/users/${me.id}`);

    me = fresh;
    saveMe();

    socket.emit("identify", me.id);

    await loadFriends();
    await loadRequests();

    renderFriendsPage();

    requestNotificationPermission();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    renderSetup();
  }
}

function saveMe() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(me)
  );
}

/* ==================================================
   初回登録
================================================== */

function renderSetup() {
  app.innerHTML = `
    <div class="setup-screen">
      <div class="setup-card">

        <div class="logo">
          morimori
        </div>

        <div class="setup-subtitle">
          学校でつながるリアルタイム連絡アプリ
        </div>

        <form
          class="setup-form"
          id="setup-form"
        >

          <label>
            表示名
            <input
              id="setup-name"
              type="text"
              maxlength="40"
              placeholder="例：谷利優樹"
              autocomplete="name"
              required
            >
          </label>

          <label>
            クラス
            <input
              id="setup-class"
              type="text"
              maxlength="30"
              placeholder="例：EL1-2"
              required
            >
          </label>

          <button
            class="primary-button"
            type="submit"
          >
            morimoriを始める
          </button>

        </form>

      </div>
    </div>
  `;

  document
    .getElementById("setup-form")
    .addEventListener(
      "submit",
      createAccount
    );
}

async function createAccount(event) {
  event.preventDefault();

  const name =
    document
      .getElementById("setup-name")
      .value.trim();

  const className =
    document
      .getElementById("setup-class")
      .value.trim();

  if (!name || !className) {
    return;
  }

  try {
    const user =
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name,
          className
        })
      });

    me = user;

    saveMe();

    socket.emit(
      "identify",
      me.id
    );

    await loadFriends();
    await loadRequests();

    renderFriendsPage();

    requestNotificationPermission();
  } catch (error) {
    showToast(error.message);
  }
}

/* ==================================================
   データ取得
================================================== */

async function loadFriends() {
  if (!me) return;

  friends =
    await api(`/api/friends/${me.id}`);
}

async function loadRequests() {
  if (!me) return;

  const data =
    await api(
      `/api/friend-requests/${me.id}`
    );

  incomingRequests =
    data.incoming || [];

  outgoingRequests =
    data.outgoing || [];
}

async function loadUsers() {
  allUsers =
    await api("/api/users");
}

/* ==================================================
   ナビゲーション
================================================== */

function renderNavigation() {
  return `
    <nav class="bottom-nav">

      <button
        class="nav-item ${
          currentPage === "friends"
            ? "active"
            : ""
        }"
        data-page="friends"
      >
        <span>👥</span>
        <small>友達</small>
      </button>

      <button
        class="nav-item ${
          currentPage === "search"
            ? "active"
            : ""
        }"
        data-page="search"
      >
        <span>⌕</span>
        <small>検索</small>
      </button>

      <button
        class="nav-item ${
          currentPage === "requests"
            ? "active"
            : ""
        }"
        data-page="requests"
      >
        <span>◉</span>
        <small>申請</small>
      </button>

      <button
        class="nav-item ${
          currentPage === "profile"
            ? "active"
            : ""
        }"
        data-page="profile"
      >
        <span>●</span>
        <small>設定</small>
      </button>

    </nav>
  `;
}

function bindNavigation() {
  document
    .querySelectorAll(".nav-item")
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const page =
            button.dataset.page;

          currentPage = page;

          if (page === "friends") {
            await loadFriends();
            renderFriendsPage();
          }

          if (page === "search") {
            await loadUsers();
            renderSearchPage();
          }

          if (page === "requests") {
            await loadRequests();
            renderRequestsPage();
          }

          if (page === "profile") {
            renderProfilePage();
          }
        }
      );
    });
}

/* ==================================================
   友達一覧
================================================== */

function renderFriendsPage() {
  currentPage = "friends";

  app.innerHTML = `
    <div class="app-shell">

      <header class="topbar">

        <div>
          <div class="topbar-title">
            友達
          </div>

          <div class="topbar-subtitle">
            ${escapeHtml(me.name)}
          </div>
        </div>

        <div class="topbar-actions">

          <button
            class="icon-button"
            id="refresh-friends"
            title="更新"
          >
            ↻
          </button>

        </div>

      </header>

      <main class="main-content">

        <div class="friend-tools">

          <button
            class="add-friend-button"
            id="add-friend"
          >
            ＋ 友達を追加
          </button>

          <button
            class="request-button"
            id="open-requests"
          >
            申請
            ${
              incomingRequests.length
                ? `<span class="badge">
                    ${incomingRequests.length}
                   </span>`
                : ""
            }
          </button>

        </div>

        <section class="friend-section">

          <div class="section-title">
            お気に入り
          </div>

          <div
            class="friend-list"
            id="favorite-list"
          ></div>

        </section>

        <section class="friend-section">

          <div class="section-title">
            最近のやりとり
          </div>

          <div
            class="friend-list"
            id="recent-list"
          ></div>

        </section>

        <section class="friend-section">

          <div class="section-title">
            友達
          </div>

          <div
            class="friend-list"
            id="normal-list"
          ></div>

        </section>

      </main>

      ${renderNavigation()}

    </div>
  `;

  document
    .getElementById("add-friend")
    .addEventListener(
      "click",
      async () => {
        currentPage = "search";
        await loadUsers();
        renderSearchPage();
      }
    );

  document
    .getElementById("open-requests")
    .addEventListener(
      "click",
      async () => {
        currentPage = "requests";
        await loadRequests();
        renderRequestsPage();
      }
    );

  document
    .getElementById("refresh-friends")
    .addEventListener(
      "click",
      async () => {
        await loadFriends();
        renderFriendsPage();
      }
    );

  renderFriendLists();
  bindNavigation();
}

function renderFriendLists() {
  const favoriteList =
    document.getElementById(
      "favorite-list"
    );

  const recentList =
    document.getElementById(
      "recent-list"
    );

  const normalList =
    document.getElementById(
      "normal-list"
    );

  if (!favoriteList) return;

  const favorites =
    friends.filter(
      friend => friend.favorite
    );

  const recent =
    friends
      .filter(
        friend =>
          !friend.favorite &&
          friend.lastMessageAt
      )
      .sort(
        (a, b) =>
          b.lastMessageAt -
          a.lastMessageAt
      );

  const normal =
    friends.filter(
      friend =>
        !friend.favorite &&
        !friend.lastMessageAt
    );

  favoriteList.innerHTML =
    favorites.length
      ? favorites
          .map(friendCardHtml)
          .join("")
      : emptyMiniHtml(
          "お気に入りはありません"
        );

  recentList.innerHTML =
    recent.length
      ? recent
          .map(friendCardHtml)
          .join("")
      : emptyMiniHtml(
          "最近のやりとりはありません"
        );

  normalList.innerHTML =
    normal.length
      ? normal
          .map(friendCardHtml)
          .join("")
      : emptyMiniHtml(
          "友達を追加してみよう"
        );

  bindFriendCards();
}

function emptyMiniHtml(text) {
  return `
    <div class="empty-state small-empty">
      ${escapeHtml(text)}
    </div>
  `;
}

function friendCardHtml(friend) {
  return `
    <button
      class="friend-card"
      data-user-id="${friend.id}"
    >

      ${avatarHtml(friend)}

      <div class="friend-info">

        <div class="friend-name-row">

          <span class="friend-name">
            ${escapeHtml(friend.name)}
          </span>

          ${
            friend.favorite
              ? `<span class="favorite-star">★</span>`
              : ""
          }

          ${
            friend.online
              ? `<span class="online-dot"></span>`
              : ""
          }

        </div>

        <div class="friend-class">
          ${escapeHtml(friend.className)}

          ${
            friend.lastMessageText
              ? ` · ${escapeHtml(
                  friend.lastMessageText.slice(
                    0,
                    25
                  )
                )}`
              : ""
          }
        </div>

      </div>

      <div class="friend-meta">

        ${
          friend.lastMessageAt
            ? `<div class="last-time">
                ${formatTime(
                  friend.lastMessageAt
                )}
              </div>`
            : ""
        }

        ${
          friend.unread
            ? `<div class="unread-badge">
                ${
                  friend.unread > 99
                    ? "99+"
                    : friend.unread
                }
              </div>`
            : ""
        }

      </div>

    </button>
  `;
}

function bindFriendCards() {
  document
    .querySelectorAll(".friend-card")
    .forEach(card => {
      card.addEventListener(
        "click",
        () => {
          const userId =
            card.dataset.userId;

          const friend =
            friends.find(
              item =>
                item.id === userId
            );

          if (friend) {
            openChat(friend);
          }
        }
      );
    });
}

/* ==================================================
   検索
================================================== */

function renderSearchPage() {
  currentPage = "search";

  app.innerHTML = `
    <div class="app-shell">

      <header class="topbar">

        <div>
          <div class="topbar-title">
            友達を追加
          </div>

          <div class="topbar-subtitle">
            名前またはクラスで探せます
          </div>
        </div>

      </header>

      <main class="main-content">

        <div class="search-box">

          <input
            id="user-search"
            type="search"
            placeholder="名前・クラスを検索"
            autocomplete="off"
          >

        </div>

        <div
          id="user-search-results"
          class="user-search-results"
        ></div>

      </main>

      ${renderNavigation()}

    </div>
  `;

  const input =
    document.getElementById(
      "user-search"
    );

  input.addEventListener(
    "input",
    () => {
      clearTimeout(searchTimer);

      searchTimer =
        setTimeout(
          () => {
            renderUserSearchResults(
              input.value
            );
          },
          120
        );
    }
  );

  renderUserSearchResults("");

  bindNavigation();
}

function renderUserSearchResults(keyword) {
  const container =
    document.getElementById(
      "user-search-results"
    );

  if (!container) return;

  const q =
    keyword
      .trim()
      .toLowerCase();

  const users =
    allUsers.filter(
      user =>
        user.id !== me.id &&
        (
          !q ||
          user.name
            .toLowerCase()
            .includes(q) ||
          user.className
            .toLowerCase()
            .includes(q)
        )
    );

  if (!users.length) {
    container.innerHTML =
      emptyMiniHtml(
        q
          ? "ユーザーが見つかりません"
          : "友達に追加したい人を検索"
      );

    return;
  }

  container.innerHTML =
    users
      .map(user =>
        userSearchCardHtml(user)
      )
      .join("");

  container
    .querySelectorAll(
      ".user-search-card"
    )
    .forEach(card => {
      card.addEventListener(
        "click",
        () => {
          sendFriendRequest(
            card.dataset.userId
          );
        }
      );
    });
}

function userSearchCardHtml(user) {
  const friend =
    friends.some(
      item =>
        item.id === user.id
    );

  const pendingOut =
    outgoingRequests.some(
      request =>
        request.to === user.id &&
        request.status === "pending"
    );

  const pendingIn =
    incomingRequests.some(
      request =>
        request.from === user.id &&
        request.status === "pending"
    );

  let action = "＋ 追加";

  if (friend) {
    action = "✓ 友達";
  } else if (pendingOut) {
    action = "申請済み";
  } else if (pendingIn) {
    action = "承認待ち";
  }

  return `
    <button
      class="user-search-card"
      data-user-id="${user.id}"
      ${
        friend ||
        pendingOut ||
        pendingIn
          ? "disabled"
          : ""
      }
    >

      ${avatarHtml(user)}

      <div class="friend-info">

        <div class="friend-name">
          ${escapeHtml(user.name)}
        </div>

        <div class="friend-class">
          ${escapeHtml(
            user.className
          )}
        </div>

      </div>

      <div class="search-card-status">
        ${action}
      </div>

    </button>
  `;
}

async function sendFriendRequest(userId) {
  try {
    await api(
      "/api/friend-requests",
      {
        method: "POST",
        body: JSON.stringify({
          from: me.id,
          to: userId
        })
      }
    );

    await loadRequests();

    showToast(
      "友達申請を送りました"
    );

    const input =
      document.getElementById(
        "user-search"
      );

    renderUserSearchResults(
      input?.value || ""
    );
  } catch (error) {
    showToast(error.message);
  }
}

/* ==================================================
   申請
================================================== */

function renderRequestsPage() {
  currentPage = "requests";

  app.innerHTML = `
    <div class="app-shell">

      <header class="topbar">

        <div>
          <div class="topbar-title">
            友達申請
          </div>

          <div class="topbar-subtitle">
            ${incomingRequests.length}件の申請
          </div>
        </div>

      </header>

      <main class="main-content">

        <section class="friend-section">

          <div class="section-title">
            受信した申請
          </div>

          <div id="incoming-list"></div>

        </section>

        <section class="friend-section">

          <div class="section-title">
            送信した申請
          </div>

          <div id="outgoing-list"></div>

        </section>

      </main>

      ${renderNavigation()}

    </div>
  `;

  renderRequestsLists();
  bindNavigation();
}

function renderRequestsLists() {
  const incoming =
    document.getElementById(
      "incoming-list"
    );

  const outgoing =
    document.getElementById(
      "outgoing-list"
    );

  if (!incoming) return;

  incoming.innerHTML =
    incomingRequests.length
      ? incomingRequests
          .map(incomingRequestHtml)
          .join("")
      : emptyMiniHtml(
          "新しい申請はありません"
        );

  outgoing.innerHTML =
    outgoingRequests.length
      ? outgoingRequests
          .map(outgoingRequestHtml)
          .join("")
      : emptyMiniHtml(
          "送信した申請はありません"
        );

  incoming
    .querySelectorAll("[data-action]")
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          handleRequest(
            button.dataset.id,
            button.dataset.action
          );
        }
      );
    });
}

function incomingRequestHtml(request) {
  const user =
    request.fromUser;

  return `
    <div class="request-card">

      ${avatarHtml(user)}

      <div class="friend-info">

        <div class="friend-name">
          ${escapeHtml(user.name)}
        </div>

        <div class="friend-class">
          ${escapeHtml(user.className)}
        </div>

      </div>

      <div class="request-actions">

        <button
          class="accept-button"
          data-id="${request.id}"
          data-action="accept"
        >
          承認
        </button>

        <button
          class="reject-button"
          data-id="${request.id}"
          data-action="reject"
        >
          拒否
        </button>

      </div>

    </div>
  `;
}

function outgoingRequestHtml(request) {
  const user =
    request.toUser;

  return `
    <div class="request-card">

      ${avatarHtml(user)}

      <div class="friend-info">

        <div class="friend-name">
          ${escapeHtml(user.name)}
        </div>

        <div class="friend-class">
          ${escapeHtml(user.className)}
        </div>

      </div>

      <div class="request-pending">
        申請中
      </div>

    </div>
  `;
}

async function handleRequest(
  requestId,
  action
) {
  try {
    await api(
      `/api/friend-requests/${requestId}/${action}`,
      {
        method: "POST"
      }
    );

    await loadFriends();
    await loadRequests();

    showToast(
      action === "accept"
        ? "友達に追加しました"
        : "申請を拒否しました"
    );

    renderRequestsPage();
  } catch (error) {
    showToast(error.message);
  }
}

/* ==================================================
   チャット
================================================== */

async function openChat(user) {
  currentChatUser = user;
  replyTarget = null;

  try {
    currentMessages =
      await api(
        `/api/messages/${me.id}/${user.id}`
      );
  } catch {
    currentMessages = [];
  }

  renderChat();
  markCurrentChatRead();
}

function renderChat() {
  if (!currentChatUser) return;

  app.innerHTML = `
    <div class="app-shell chat-shell">

      <header class="chat-header">

        <button
          class="back-button"
          id="chat-back"
        >
          ‹
        </button>

        <button
          class="chat-user-button"
          id="chat-user-profile"
        >

          ${avatarHtml(
            currentChatUser
          )}

          <div class="chat-user-info">

            <div class="chat-title">
              ${escapeHtml(
                currentChatUser.name
              )}
            </div>

            <div
              class="chat-presence"
              id="chat-presence"
            >
              ${
                currentChatUser.online
                  ? "オンライン"
                  : "オフライン"
              }
            </div>

          </div>

        </button>

        <div class="chat-actions">

          <button
            class="icon-button"
            id="audio-call-button"
            title="音声通話"
          >
            ☎
          </button>

          <button
            class="icon-button"
            id="video-call-button"
            title="ビデオ通話"
          >
            ▣
          </button>

        </div>

      </header>

      <main
        class="messages"
        id="messages"
      ></main>

      <div
        id="reply-preview-container"
      ></div>

      <form
        class="composer"
        id="composer"
      >

        <button
          type="button"
          class="composer-plus"
          id="plus-button"
        >
          ＋
        </button>

        <textarea
          id="message-input"
          rows="1"
          placeholder="メッセージ"
          autocomplete="off"
        ></textarea>

        <button
          type="submit"
          class="send-button"
        >
          ↑
        </button>

      </form>

    </div>
  `;

  renderMessages();
  renderReplyPreview();

  document
    .getElementById("chat-back")
    .addEventListener(
      "click",
      async () => {
        if (currentCall) {
          showToast(
            "通話中は先に通話を終了してください"
          );
          return;
        }

        currentChatUser = null;

        await loadFriends();

        renderFriendsPage();
      }
    );

  document
    .getElementById("composer")
    .addEventListener(
      "submit",
      sendCurrentMessage
    );

  document
    .getElementById("audio-call-button")
    .addEventListener(
      "click",
      () => {
        startCall(
          "audio",
          currentChatUser
        );
      }
    );

  document
    .getElementById("video-call-button")
    .addEventListener(
      "click",
      () => {
        startCall(
          "video",
          currentChatUser
        );
      }
    );

  const input =
    document.getElementById(
      "message-input"
    );

  input.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        if (
          event.isComposing ||
          event.keyCode === 229
        ) {
          return;
        }

        event.preventDefault();

        document
          .getElementById("composer")
          .requestSubmit();
      }
    }
  );

  input.addEventListener(
    "input",
    autoResizeTextarea
  );

  document
    .getElementById("plus-button")
    .addEventListener(
      "click",
      () => {
        showToast(
          "画像・ファイル送信は次の段階で追加します"
        );
      }
    );
}

function autoResizeTextarea(event) {
  const textarea =
    event.target;

  textarea.style.height = "auto";

  textarea.style.height =
    Math.min(
      textarea.scrollHeight,
      140
    ) + "px";
}

function renderMessages() {
  const container =
    document.getElementById(
      "messages"
    );

  if (!container) return;

  if (!currentMessages.length) {
    container.innerHTML = `
      <div class="chat-empty">

        ${avatarHtml(
          currentChatUser,
          true
        )}

        <div class="chat-empty-name">
          ${escapeHtml(
            currentChatUser.name
          )}
        </div>

        <div class="chat-empty-text">
          ここからメッセージを始めよう
        </div>

      </div>
    `;

    return;
  }

  container.innerHTML =
    currentMessages
      .map(messageHtml)
      .join("");

  container
    .querySelectorAll(
      "[data-reply-id]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const id =
            button.dataset.replyId;

          const message =
            currentMessages.find(
              item =>
                item.id === id
            );

          if (message) {
            replyTarget = message;

            renderReplyPreview();

            document
              .getElementById(
                "message-input"
              )
              ?.focus();
          }
        }
      );
    });

  container
    .querySelectorAll(
      "[data-delete-id]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          deleteMessage(
            button.dataset.deleteId
          );
        }
      );
    });

  requestAnimationFrame(() => {
    container.scrollTop =
      container.scrollHeight;
  });
}

function messageHtml(message) {
  const mine =
    message.from === me.id;

  const original =
    message.replyTo
      ? currentMessages.find(
          item =>
            item.id ===
            message.replyTo
        )
      : null;

  return `
    <div
      class="message-row ${
        mine
          ? "mine"
          : "theirs"
      }"
    >

      <div class="message-bubble">

        ${
          original
            ? `
              <div class="reply-reference">

                <div class="reply-reference-name">
                  ${
                    original.from === me.id
                      ? "あなた"
                      : escapeHtml(
                          currentChatUser.name
                        )
                  }
                </div>

                <div class="reply-reference-text">
                  ${
                    original.deleted
                      ? "削除されたメッセージ"
                      : escapeHtml(
                          original.text
                        )
                  }
                </div>

              </div>
            `
            : ""
        }

        <div
          class="message-text ${
            message.deleted
              ? "deleted"
              : ""
          }"
        >
          ${
            message.deleted
              ? "削除されたメッセージ"
              : escapeHtml(
                  message.text
                ).replaceAll(
                  "\n",
                  "<br>"
                )
          }
        </div>

        <div class="message-bottom">

          <span>
            ${formatTime(
              message.createdAt
            )}
          </span>

          ${
            mine
              ? `
                <span class="message-read">
                  ${
                    message.read
                      ? "既読"
                      : "送信済み"
                  }
                </span>
              `
              : ""
          }

        </div>

        ${
          !message.deleted
            ? `
              <div class="message-actions">

                <button
                  type="button"
                  data-reply-id="${message.id}"
                  title="返信"
                >
                  ↩
                </button>

                ${
                  mine
                    ? `
                      <button
                        type="button"
                        data-delete-id="${message.id}"
                        title="削除"
                      >
                        ×
                      </button>
                    `
                    : ""
                }

              </div>
            `
            : ""
        }

      </div>

    </div>
  `;
}

async function sendCurrentMessage(event) {
  event.preventDefault();

  const input =
    document.getElementById(
      "message-input"
    );

  if (!input) return;

  const text =
    input.value;

  if (!text.trim()) return;

  socket.emit(
    "send-message",
    {
      to:
        currentChatUser.id,
      text,
      replyTo:
        replyTarget?.id ||
        null
    }
  );

  input.value = "";
  input.style.height = "auto";

  replyTarget = null;

  renderReplyPreview();

  input.focus();
}

function renderReplyPreview() {
  const container =
    document.getElementById(
      "reply-preview-container"
    );

  if (!container) return;

  if (!replyTarget) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="reply-preview">

      <div>

        <div class="reply-preview-title">
          返信
        </div>

        <div class="reply-preview-text">
          ${
            replyTarget.deleted
              ? "削除されたメッセージ"
              : escapeHtml(
                  replyTarget.text
                )
          }
        </div>

      </div>

      <button
        type="button"
        id="cancel-reply"
      >
        ×
      </button>

    </div>
  `;

  document
    .getElementById(
      "cancel-reply"
    )
    .addEventListener(
      "click",
      () => {
        replyTarget = null;
        renderReplyPreview();
      }
    );
}

async function deleteMessage(messageId) {
  if (
    !confirm(
      "このメッセージを削除しますか？"
    )
  ) {
    return;
  }

  try {
    await api(
      `/api/messages/${me.id}/${messageId}`,
      {
        method: "DELETE"
      }
    );
  } catch (error) {
    showToast(error.message);
  }
}

function markCurrentChatRead() {
  if (!currentChatUser) return;

  socket.emit(
    "mark-read",
    {
      otherUserId:
        currentChatUser.id
    }
  );
}

/* ==================================================
   プロフィール
================================================== */

function renderProfilePage() {
  currentPage = "profile";

  app.innerHTML = `
    <div class="app-shell">

      <header class="topbar">

        <div>
          <div class="topbar-title">
            設定
          </div>

          <div class="topbar-subtitle">
            プロフィール
          </div>
        </div>

      </header>

      <main class="profile-content">

        <div class="profile-card">

          <button
            class="profile-avatar-button"
            id="avatar-button"
          >

            ${avatarHtml(
              me,
              true
            )}

            <span class="avatar-edit">
              ✎
            </span>

          </button>

          <input
            type="file"
            id="avatar-input"
            accept="image/*"
            hidden
          >

          <h2>
            ${escapeHtml(me.name)}
          </h2>

          <div class="profile-class">
            ${escapeHtml(
              me.className
            )}
          </div>

          <div class="profile-status">
            morimori
          </div>

          <label class="profile-field">
            表示名
            <input
              id="profile-name"
              maxlength="40"
              value="${escapeHtml(
                me.name
              )}"
            >
          </label>

          <label class="profile-field">
            クラス
            <input
              id="profile-class"
              maxlength="30"
              value="${escapeHtml(
                me.className
              )}"
            >
          </label>

          <button
            class="primary-button"
            id="save-profile"
          >
            保存
          </button>

        </div>

      </main>

      ${renderNavigation()}

    </div>
  `;

  document
    .getElementById("avatar-button")
    .addEventListener(
      "click",
      () => {
        document
          .getElementById(
            "avatar-input"
          )
          .click();
      }
    );

  document
    .getElementById("avatar-input")
    .addEventListener(
      "change",
      handleAvatar
    );

  document
    .getElementById("save-profile")
    .addEventListener(
      "click",
      saveProfile
    );

  bindNavigation();
}

function handleAvatar(event) {
  const file =
    event.target.files?.[0];

  if (!file) return;

  if (
    !file.type.startsWith("image/")
  ) {
    showToast(
      "画像を選択してください"
    );

    return;
  }

  const reader =
    new FileReader();

  reader.onload = () => {
    resizeImage(
      reader.result,
      512
    ).then(
      dataUrl => {
        me.icon = dataUrl;

        saveMe();

        renderProfilePage();

        showToast(
          "アイコンを変更しました"
        );
      }
    );
  };

  reader.readAsDataURL(file);
}

function resizeImage(
  source,
  size
) {
  return new Promise(
    resolve => {
      const image =
        new Image();

      image.onload = () => {
        const canvas =
          document.createElement(
            "canvas"
          );

        canvas.width = size;
        canvas.height = size;

        const ctx =
          canvas.getContext(
            "2d"
          );

        const scale =
          Math.max(
            size / image.width,
            size / image.height
          );

        const width =
          image.width * scale;

        const height =
          image.height * scale;

        const x =
          (size - width) / 2;

        const y =
          (size - height) / 2;

        ctx.drawImage(
          image,
          x,
          y,
          width,
          height
        );

        resolve(
          canvas.toDataURL(
            "image/jpeg",
            0.85
          )
        );
      };

      image.src = source;
    }
  );
}

async function saveProfile() {
  const name =
    document
      .getElementById(
        "profile-name"
      )
      .value.trim();

  const className =
    document
      .getElementById(
        "profile-class"
      )
      .value.trim();

  if (!name || !className) {
    showToast(
      "表示名とクラスを入力してください"
    );
    return;
  }

  try {
    const updated =
      await api(
        `/api/users/${me.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name,
            className,
            icon: me.icon || null
          })
        }
      );

    me = updated;

    saveMe();

    await loadFriends();

    showToast(
      "プロフィールを保存しました"
    );

    renderProfilePage();
  } catch (error) {
    showToast(error.message);
  }
}

/* ==================================================
   通話
================================================== */

function injectCallStyles() {
  if (
    document.getElementById(
      "morimori-call-styles"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "morimori-call-styles";

  style.textContent = `
    .call-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(4, 6, 9, .96);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .call-card {
      width: min(440px, 100%);
      background: #101419;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 28px;
      padding: 30px;
      box-shadow: 0 30px 100px rgba(0,0,0,.55);
      text-align: center;
    }

    .call-card .avatar.large {
      width: 96px;
      height: 96px;
      margin: 0 auto 18px;
    }

    .call-name {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
    }

    .call-status {
      margin-top: 8px;
      color: #8e9aa8;
      font-size: 14px;
    }

    .call-actions {
      display: flex;
      justify-content: center;
      gap: 22px;
      margin-top: 30px;
    }

    .call-action {
      width: 62px;
      height: 62px;
      border-radius: 50%;
      border: 0;
      font-size: 24px;
      cursor: pointer;
    }

    .call-accept {
      background: #18c99a;
      color: #fff;
    }

    .call-reject,
    .call-end {
      background: #e95757;
      color: #fff;
    }

    .call-screen {
      position: fixed;
      inset: 0;
      z-index: 99998;
      background: #05070a;
      overflow: hidden;
    }

    .remote-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #05070a;
    }

    .local-video {
      position: absolute;
      right: 18px;
      top: 18px;
      width: min(30vw, 220px);
      aspect-ratio: 3 / 4;
      object-fit: cover;
      border-radius: 18px;
      background: #111;
      border: 1px solid rgba(255,255,255,.18);
      box-shadow: 0 12px 35px rgba(0,0,0,.4);
    }

    .call-screen-audio {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      background:
        radial-gradient(
          circle at center,
          #18232c 0%,
          #080b0e 65%
        );
    }

    .call-screen-audio .avatar.large {
      width: 120px;
      height: 120px;
      font-size: 42px;
      margin-bottom: 22px;
    }

    .call-screen-name {
      color: #fff;
      font-size: 24px;
      font-weight: 700;
    }

    .call-screen-status {
      color: #8e9aa8;
      margin-top: 8px;
    }

    .call-controls {
      position: absolute;
      left: 50%;
      bottom: max(28px, env(safe-area-inset-bottom));
      transform: translateX(-50%);
      display: flex;
      gap: 16px;
      padding: 10px 16px;
      border-radius: 999px;
      background: rgba(16,20,25,.82);
      backdrop-filter: blur(18px);
    }

    .call-control {
      width: 54px;
      height: 54px;
      border: 0;
      border-radius: 50%;
      background: #252c34;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
    }

    .call-control.active {
      background: #18c99a;
    }

    .call-control.end {
      background: #e95757;
    }

    @media (max-width: 600px) {
      .call-card {
        padding: 26px 20px;
        border-radius: 24px;
      }

      .local-video {
        width: 110px;
        right: 12px;
        top: 12px;
        border-radius: 14px;
      }

      .call-controls {
        bottom: max(18px, env(safe-area-inset-bottom));
      }

      .call-control {
        width: 50px;
        height: 50px;
      }
    }
  `;

  document.head.appendChild(style);
}

function isCallingUser(userId) {
  return Boolean(
    currentCall &&
    currentCall.userId === userId
  );
}

async function startCall(
  type,
  user
) {
  if (!me || !user) return;

  if (user.id === me.id) {
    showToast(
      "自分には通話できません"
    );
    return;
  }

  if (callBusy || currentCall) {
    showToast(
      "すでに通話中です"
    );
    return;
  }

  if (!user.online) {
    showToast(
      "相手がオフラインです"
    );
    return;
  }

  callBusy = true;

  currentCall = {
    userId: user.id,
    user,
    type,
    role: "caller"
  };

  showOutgoingCallUI();

  socket.emit(
    "call-user",
    {
      to: user.id,
      from: me.id,
      type
    }
  );
}

function showOutgoingCallUI() {
  removeCallUI();

  const user =
    currentCall.user;

  const overlay =
    document.createElement(
      "div"
    );

  overlay.className =
    "call-overlay";

  overlay.id =
    "outgoing-call-overlay";

  overlay.innerHTML = `
    <div class="call-card">

      ${avatarHtml(
        user,
        true
      )}

      <div class="call-name">
        ${escapeHtml(user.name)}
      </div>

      <div class="call-status">
        ${
          currentCall.type === "video"
            ? "ビデオ通話を発信中…"
            : "音声通話を発信中…"
        }
      </div>

      <div class="call-actions">

        <button
          class="call-action call-reject"
          id="cancel-outgoing-call"
        >
          ☎
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(
    overlay
  );

  document
    .getElementById(
      "cancel-outgoing-call"
    )
    .addEventListener(
      "click",
      () => {
        endCall(true);
      }
    );
}

function showIncomingCallUI(data) {
  if (!me) return;

  if (
    callBusy ||
    currentCall
  ) {
    socket.emit(
      "call-rejected",
      {
        to: data.from,
        from: me.id
      }
    );

    return;
  }

  const caller =
    data.fromUser || {
      id: data.from,
      name: "通話"
    };

  currentCall = {
    userId: data.from,
    user: caller,
    type:
      data.type === "video"
        ? "video"
        : "audio",
    role: "callee"
  };

  callBusy = true;

  removeCallUI();

  const overlay =
    document.createElement(
      "div"
    );

  overlay.className =
    "call-overlay";

  overlay.id =
    "incoming-call-overlay";

  overlay.innerHTML = `
    <div class="call-card">

      ${avatarHtml(
        caller,
        true
      )}

      <div class="call-name">
        ${escapeHtml(
          caller.name ||
          "通話"
        )}
      </div>

      <div class="call-status">
        ${
          currentCall.type === "video"
            ? "ビデオ通話がかかってきています"
            : "音声通話がかかってきています"
        }
      </div>

      <div class="call-actions">

        <button
          class="call-action call-reject"
          id="reject-incoming-call"
        >
          ×
        </button>

        <button
          class="call-action call-accept"
          id="accept-incoming-call"
        >
          ☎
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(
    overlay
  );

  document
    .getElementById(
      "reject-incoming-call"
    )
    .addEventListener(
      "click",
      () => {
        rejectIncomingCall();
      }
    );

  document
    .getElementById(
      "accept-incoming-call"
    )
    .addEventListener(
      "click",
      () => {
        acceptIncomingCall();
      }
    );

  showBrowserNotification(
    "morimori 通話",
    `${caller.name || "友達"}から${
      currentCall.type === "video"
        ? "ビデオ"
        : "音声"
    }通話です`
  );
}

async function acceptIncomingCall() {
  if (
    !currentCall ||
    currentCall.role !== "callee"
  ) {
    return;
  }

  removeCallUI();

  try {
    await prepareLocalMedia(
      currentCall.type
    );

    createPeerConnection();

    socket.emit(
      "call-accepted",
      {
        to: currentCall.userId,
        from: me.id,
        type: currentCall.type
      }
    );

    showCallScreen();
  } catch (error) {
    showToast(
      getMediaErrorMessage(error)
    );

    rejectIncomingCall();
  }
}

function rejectIncomingCall() {
  if (!currentCall) return;

  socket.emit(
    "call-rejected",
    {
      to: currentCall.userId,
      from: me.id
    }
  );

  cleanupCall();
}

async function prepareLocalMedia(type) {
  if (localStream) {
    localStream
      .getTracks()
      .forEach(track =>
        track.stop()
      );

    localStream = null;
  }

  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video:
      type === "video"
        ? {
            facingMode: "user",
            width: {
              ideal: 1280
            },
            height: {
              ideal: 720
            }
          }
        : false
  };

  localStream =
    await navigator.mediaDevices.getUserMedia(
      constraints
    );
}

function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection =
    new RTCPeerConnection(
      RTC_CONFIG
    );

  pendingIceCandidates = [];

  if (localStream) {
    localStream
      .getTracks()
      .forEach(track => {
        peerConnection.addTrack(
          track,
          localStream
        );
      });
  }

  peerConnection.onicecandidate =
    event => {
      if (!event.candidate) return;

      if (!currentCall) return;

      socket.emit(
        "webrtc-ice",
        {
          to:
            currentCall.userId,
          from: me.id,
          candidate:
            event.candidate
        }
      );
    };

  peerConnection.ontrack =
    event => {
      let remoteVideo =
        document.getElementById(
          "remote-video"
        );

      let remoteAudio =
        document.getElementById(
          "remote-audio"
        );

      if (
        currentCall?.type ===
        "video"
      ) {
        if (remoteVideo) {
          remoteVideo.srcObject =
            event.streams[0];
        }
      } else {
        if (remoteAudio) {
          remoteAudio.srcObject =
            event.streams[0];
        }
      }
    };

  peerConnection.onconnectionstatechange =
    () => {
      if (!peerConnection) {
        return;
      }

      const state =
        peerConnection.connectionState;

      if (
        state === "connected"
      ) {
        updateCallStatus(
          "通話中"
        );
      }

      if (
        state === "disconnected"
      ) {
        updateCallStatus(
          "接続が不安定です"
        );
      }

      if (
        state === "failed"
      ) {
        showToast(
          "通話接続に失敗しました"
        );

        endCall(true);
      }
    };

  peerConnection.oniceconnectionstatechange =
    () => {
      if (!peerConnection) {
        return;
      }

      if (
        peerConnection.iceConnectionState ===
        "failed"
      ) {
        showToast(
          "ネットワーク接続を確立できませんでした"
        );
      }
    };
}

async function createCallerOffer() {
  if (
    !peerConnection ||
    !currentCall
  ) {
    return;
  }

  const offer =
    await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo:
        currentCall.type ===
        "video"
    });

  await peerConnection.setLocalDescription(
    offer
  );

  socket.emit(
    "webrtc-offer",
    {
      to: currentCall.userId,
      from: me.id,
      offer
    }
  );
}

async function handleOffer(data) {
  if (!currentCall) return;

  if (
    data.from !==
    currentCall.userId
  ) {
    return;
  }

  try {
    if (!peerConnection) {
      await prepareLocalMedia(
        currentCall.type
      );

      createPeerConnection();

      showCallScreen();
    }

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(
        data.offer
      )
    );

    await flushPendingIce();

    const answer =
      await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(
      answer
    );

    socket.emit(
      "webrtc-answer",
      {
        to: currentCall.userId,
        from: me.id,
        answer
      }
    );

    updateCallStatus(
      "接続中…"
    );
  } catch (error) {
    console.error(
      "offer error",
      error
    );

    showToast(
      "通話の接続に失敗しました"
    );
  }
}

async function handleAnswer(data) {
  if (
    !peerConnection ||
    !currentCall
  ) {
    return;
  }

  if (
    data.from !==
    currentCall.userId
  ) {
    return;
  }

  try {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(
        data.answer
      )
    );

    await flushPendingIce();

    updateCallStatus(
      "接続中…"
    );
  } catch (error) {
    console.error(
      "answer error",
      error
    );
  }
}

async function handleIce(data) {
  if (
    !currentCall ||
    data.from !==
      currentCall.userId
  ) {
    return;
  }

  const candidate =
    new RTCIceCandidate(
      data.candidate
    );

  if (
    peerConnection &&
    peerConnection.remoteDescription
  ) {
    try {
      await peerConnection.addIceCandidate(
        candidate
      );
    } catch (error) {
      console.error(
        "ICE error",
        error
      );
    }
  } else {
    pendingIceCandidates.push(
      candidate
    );
  }
}

async function flushPendingIce() {
  if (
    !peerConnection ||
    !peerConnection.remoteDescription
  ) {
    return;
  }

  const candidates =
    pendingIceCandidates;

  pendingIceCandidates = [];

  for (
    const candidate of candidates
  ) {
    try {
      await peerConnection.addIceCandidate(
        candidate
      );
    } catch (error) {
      console.error(
        "queued ICE error",
        error
      );
    }
  }
}

function showCallScreen() {
  removeCallUI();

  if (!currentCall) return;

  const screen =
    document.createElement(
      "div"
    );

  screen.className =
    "call-screen";

  screen.id =
    "active-call-screen";

  if (
    currentCall.type ===
    "video"
  ) {
    screen.innerHTML = `
      <video
        id="remote-video"
        class="remote-video"
        autoplay
        playsinline
      ></video>

      <video
        id="local-video"
        class="local-video"
        autoplay
        muted
        playsinline
      ></video>

      <audio
        id="remote-audio"
        autoplay
      ></audio>

      <div class="call-controls">

        <button
          class="call-control"
          id="mute-call"
          title="ミュート"
        >
          🎙
        </button>

        <button
          class="call-control"
          id="toggle-camera"
          title="カメラ"
        >
          📷
        </button>

        <button
          class="call-control end"
          id="end-active-call"
          title="終了"
        >
          ☎
        </button>

      </div>
    `;
  } else {
    screen.innerHTML = `
      <div class="call-screen-audio">

        <div id="audio-call-avatar">
          ${avatarHtml(
            currentCall.user,
            true
          )}
        </div>

        <div class="call-screen-name">
          ${escapeHtml(
            currentCall.user.name
          )}
        </div>

        <div
          class="call-screen-status"
          id="active-call-status"
        >
          接続中…
        </div>

      </div>

      <audio
        id="remote-audio"
        autoplay
      ></audio>

      <div class="call-controls">

        <button
          class="call-control"
          id="mute-call"
          title="ミュート"
        >
          🎙
        </button>

        <button
          class="call-control end"
          id="end-active-call"
          title="終了"
        >
          ☎
        </button>

      </div>
    `;
  }

  document.body.appendChild(
    screen
  );

  const localVideo =
    document.getElementById(
      "local-video"
    );

  if (
    localVideo &&
    localStream
  ) {
    localVideo.srcObject =
      localStream;
  }

  document
    .getElementById(
      "mute-call"
    )
    ?.addEventListener(
      "click",
      toggleMute
    );

  document
    .getElementById(
      "toggle-camera"
    )
    ?.addEventListener(
      "click",
      toggleCamera
    );

  document
    .getElementById(
      "end-active-call"
    )
    ?.addEventListener(
      "click",
      () => {
        endCall(true);
      }
    );
}

function updateCallStatus(text) {
  const status =
    document.getElementById(
      "active-call-status"
    );

  if (status) {
    status.textContent =
      text;
  }

  const outgoing =
    document.querySelector(
      "#outgoing-call-overlay .call-status"
    );

  if (outgoing) {
    outgoing.textContent =
      text;
  }
}

function toggleMute() {
  if (!localStream) return;

  const audioTracks =
    localStream.getAudioTracks();

  if (!audioTracks.length) {
    return;
  }

  const enabled =
    audioTracks[0].enabled;

  audioTracks.forEach(
    track => {
      track.enabled =
        !enabled;
    }
  );

  const button =
    document.getElementById(
      "mute-call"
    );

  if (button) {
    button.classList.toggle(
      "active",
      !enabled
    );

    button.textContent =
      !enabled
        ? "🎙"
        : "🔇";
  }
}

function toggleCamera() {
  if (!localStream) return;

  const videoTracks =
    localStream.getVideoTracks();

  if (!videoTracks.length) {
    return;
  }

  const enabled =
    videoTracks[0].enabled;

  videoTracks.forEach(
    track => {
      track.enabled =
        !enabled;
    }
  );

  const button =
    document.getElementById(
      "toggle-camera"
    );

  if (button) {
    button.classList.toggle(
      "active",
      !enabled
    );

    button.textContent =
      !enabled
        ? "📷"
        : "🚫";
  }
}

function endCall(notify = true) {
  if (
    notify &&
    currentCall
  ) {
    socket.emit(
      "call-ended",
      {
        to:
          currentCall.userId,
        from: me?.id
      }
    );
  }

  cleanupCall();
}

function cleanupCall() {
  if (peerConnection) {
    peerConnection.ontrack =
      null;
    peerConnection.onicecandidate =
      null;
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream
      .getTracks()
      .forEach(track =>
        track.stop()
      );

    localStream = null;
  }

  pendingIceCandidates = [];

  currentCall = null;
  callBusy = false;

  removeCallUI();
}

function removeCallUI() {
  document
    .querySelectorAll(
      "#incoming-call-overlay, #outgoing-call-overlay, #active-call-screen"
    )
    .forEach(element =>
      element.remove()
    );
}

function getMediaErrorMessage(error) {
  if (
    error?.name ===
    "NotAllowedError"
  ) {
    return "マイク・カメラの使用を許可してください";
  }

  if (
    error?.name ===
    "NotFoundError"
  ) {
    return "マイクまたはカメラが見つかりません";
  }

  if (
    error?.name ===
    "NotReadableError"
  ) {
    return "マイクまたはカメラを他のアプリが使用しています";
  }

  return "マイク・カメラを使用できません";
}

/* ==================================================
   Socket.IO
================================================== */

socket.on(
  "connect",
  () => {
    if (me?.id) {
      socket.emit(
        "identify",
        me.id
      );
    }
  }
);

/* ---------- メッセージ ---------- */

socket.on(
  "message",
  message => {
    if (
      currentChatUser &&
      (
        (
          message.from ===
            me.id &&
          message.to ===
            currentChatUser.id
        ) ||
        (
          message.to ===
            me.id &&
          message.from ===
            currentChatUser.id
        )
      )
    ) {
      currentMessages.push(
        message
      );

      renderMessages();

      if (
        message.to ===
        me.id
      ) {
        markCurrentChatRead();
      }

      return;
    }

    loadFriends()
      .then(() => {
        if (
          currentPage ===
          "friends"
        ) {
          renderFriendsPage();
        }
      });

    if (
      message.to ===
      me.id
    ) {
      showToast(
        "新しいメッセージがあります"
      );
    }
  }
);

socket.on(
  "new-message-notification",
  data => {
    if (
      data?.message?.from ===
      me?.id
    ) {
      return;
    }

    const sender =
      data?.from?.name ||
      "新しいメッセージ";

    showBrowserNotification(
      sender,
      data?.message?.text ||
        "新しいメッセージがあります"
    );
  }
);

socket.on(
  "reply-notification",
  data => {
    showToast(
      `${data.from}があなたのメッセージに返信しました`
    );
  }
);

socket.on(
  "messages-read",
  async data => {
    if (
      currentChatUser &&
      data?.otherUserId ===
        currentChatUser.id
    ) {
      currentMessages =
        await api(
          `/api/messages/${me.id}/${currentChatUser.id}`
        );

      renderMessages();
    }
  }
);

/* ---------- オンライン ---------- */

socket.on(
  "presence",
  async data => {
    if (
      currentChatUser &&
      data.userId ===
        currentChatUser.id
    ) {
      currentChatUser.online =
        data.online;

      const presence =
        document.getElementById(
          "chat-presence"
        );

      if (presence) {
        presence.textContent =
          data.online
            ? "オンライン"
            : "オフライン";
      }
    }

    if (
      currentPage ===
      "friends"
    ) {
      await loadFriends();
      renderFriendsPage();
    }
  }
);

/* ---------- 友達申請 ---------- */

socket.on(
  "friend-request",
  async data => {
    await loadRequests();

    showToast(
      `${data?.fromUser?.name || "誰か"}から友達申請が届きました`
    );

    showBrowserNotification(
      "友達申請",
      `${data?.fromUser?.name || "誰か"}から友達申請が届きました`
    );

    if (
      currentPage ===
      "requests"
    ) {
      renderRequestsPage();
    }

    if (
      currentPage ===
      "friends"
    ) {
      renderFriendsPage();
    }
  }
);

socket.on(
  "friend-added",
  async data => {
    await loadFriends();

    showToast(
      `${data?.user?.name || "ユーザー"}と友達になりました`
    );

    if (
      currentPage ===
      "friends"
    ) {
      renderFriendsPage();
    }

    if (
      currentPage ===
      "search"
    ) {
      await loadUsers();

      const input =
        document.getElementById(
          "user-search"
        );

      renderUserSearchResults(
        input?.value || ""
      );
    }
  }
);

socket.on(
  "friend-removed",
  async () => {
    await loadFriends();

    if (
      currentPage ===
      "friends"
    ) {
      renderFriendsPage();
    }
  }
);

socket.on(
  "favorite-updated",
  async () => {
    await loadFriends();

    if (
      currentPage ===
      "friends"
    ) {
      renderFriendsPage();
    }
  }
);

socket.on(
  "message-deleted",
  async data => {
    if (!currentChatUser) {
      return;
    }

    currentMessages =
      await api(
        `/api/messages/${me.id}/${currentChatUser.id}`
      );

    renderMessages();
  }
);

socket.on(
  "user-updated",
  async user => {
    if (!user) return;

    if (
      user.id ===
      me.id
    ) {
      me = user;
      saveMe();
    }

    const friend =
      friends.find(
        item =>
          item.id ===
          user.id
      );

    if (friend) {
      Object.assign(
        friend,
        user
      );
    }

    if (
      currentChatUser &&
      currentChatUser.id ===
        user.id
    ) {
      Object.assign(
        currentChatUser,
        user
      );

      renderChat();
    }

    if (
      currentPage ===
      "friends"
    ) {
      renderFriendsPage();
    }
  }
);

/* ==================================================
   通話 Socket.IO
================================================== */

socket.on(
  "incoming-call",
  data => {
    if (!data?.from) {
      return;
    }

    showIncomingCallUI(
      data
    );
  }
);

socket.on(
  "call-accepted",
  async data => {
    if (
      !currentCall ||
      currentCall.role !==
        "caller"
    ) {
      return;
    }

    if (
      data.from !==
      currentCall.userId
    ) {
      return;
    }

    try {
      await prepareLocalMedia(
        currentCall.type
      );

      createPeerConnection();

      showCallScreen();

      updateCallStatus(
        "接続中…"
      );

      await createCallerOffer();
    } catch (error) {
      console.error(
        error
      );

      showToast(
        getMediaErrorMessage(
          error
        )
      );

      endCall(true);
    }
  }
);

socket.on(
  "call-rejected",
  data => {
    if (
      !currentCall ||
      data?.from !==
        currentCall.userId
    ) {
      return;
    }

    showToast(
      "通話が拒否されました"
    );

    cleanupCall();
  }
);

socket.on(
  "call-ended",
  data => {
    if (
      !currentCall
    ) {
      return;
    }

    if (
      data?.from &&
      data.from !==
        currentCall.userId
    ) {
      return;
    }

    showToast(
      "通話が終了しました"
    );

    cleanupCall();
  }
);

socket.on(
  "webrtc-offer",
  handleOffer
);

socket.on(
  "webrtc-answer",
  handleAnswer
);

socket.on(
  "webrtc-ice",
  handleIce
);

/* ==================================================
   通知
================================================== */

async function requestNotificationPermission() {
  if (
    !("Notification" in window)
  ) {
    return;
  }

  if (
    Notification.permission ===
    "default"
  ) {
    try {
      await Notification.requestPermission();
    } catch {
      // 無視
    }
  }
}

function showBrowserNotification(
  title,
  body
) {
  if (
    !("Notification" in window)
  ) {
    return;
  }

  if (
    Notification.permission !==
    "granted"
  ) {
    return;
  }

  if (
    document.visibilityState ===
    "visible"
  ) {
    return;
  }

  try {
    new Notification(
      title,
      {
        body,
        icon:
          "/icon-192.png"
      }
    );
  } catch {
    // 無視
  }
}

/* ==================================================
   ページ終了時
================================================== */

window.addEventListener(
  "beforeunload",
  () => {
    if (currentCall) {
      socket.emit(
        "call-ended",
        {
          to:
            currentCall.userId,
          from: me?.id
        }
      );
    }

    if (localStream) {
      localStream
        .getTracks()
        .forEach(track =>
          track.stop()
        );
    }
  }
);

/* ==================================================
   開始
================================================== */

init();
