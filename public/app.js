const socket = io();

const meKey = "morimori-me";

let me = null;
let users = [];
let friends = [];
let currentChatUser = null;
let messages = [];
let replyTarget = null;
let currentScreen = "friends";
let friendRequestCount = 0;

const app = document.getElementById("app");

/* =========================
   共通
========================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function getInitial(name) {
  const text = String(name || "?").trim();

  if (!text) return "?";

  return text[0];
}

function avatarHtml(user, size = "") {
  const cls = size ? `avatar ${size}` : "avatar";

  if (user?.icon) {
    return `
      <div class="${cls}">
        <img src="${escapeHtml(user.icon)}" alt="">
      </div>
    `;
  }

  return `
    <div class="${cls}">
      ${escapeHtml(getInitial(user?.name))}
    </div>
  `;
}

function showToast(text) {
  let toast = document.getElementById("morimori-toast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "morimori-toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  toast.textContent = text;
  toast.classList.add("show");

  clearTimeout(toast._timer);

  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
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
      data?.error || "通信に失敗しました。"
    );
  }

  return data;
}

/* =========================
   初期化
========================= */

async function init() {
  const saved = localStorage.getItem(meKey);

  if (!saved) {
    showSetup();
    return;
  }

  try {
    me = JSON.parse(saved);
  } catch {
    localStorage.removeItem(meKey);
    showSetup();
    return;
  }

  if (!me?.id) {
    localStorage.removeItem(meKey);
    showSetup();
    return;
  }

  try {
    me = await api(`/api/users/${me.id}`);
    localStorage.setItem(meKey, JSON.stringify(me));
  } catch {
    localStorage.removeItem(meKey);
    showSetup();
    return;
  }

  connectSocket();
  await loadFriends();
  await loadFriendRequests();

  showMain();
}

/* =========================
   初回登録
========================= */

function showSetup() {
  app.innerHTML = `
    <div class="setup-screen">
      <div class="setup-card">
        <div class="logo">morimori</div>

        <div class="setup-subtitle">
          学校でつながるリアルタイム連絡アプリ
        </div>

        <div class="setup-form">
          <label>
            名前
            <input
              id="setup-name"
              type="text"
              maxlength="40"
              placeholder="表示する名前"
              autocomplete="name"
            >
          </label>

          <label>
            クラス
            <input
              id="setup-class"
              type="text"
              maxlength="30"
              placeholder="例：1年3組"
            >
          </label>

          <button
            id="setup-button"
            class="primary-button"
          >
            はじめる
          </button>
        </div>
      </div>
    </div>
  `;

  document
    .getElementById("setup-button")
    .addEventListener("click", createAccount);

  document
    .getElementById("setup-name")
    .addEventListener("keydown", e => {
      if (e.key === "Enter") {
        createAccount();
      }
    });

  document
    .getElementById("setup-class")
    .addEventListener("keydown", e => {
      if (e.key === "Enter") {
        createAccount();
      }
    });
}

async function createAccount() {
  const name =
    document.getElementById("setup-name")
      ?.value
      .trim();

  const className =
    document.getElementById("setup-class")
      ?.value
      .trim();

  if (!name || !className) {
    showToast("名前とクラスを入力してください");
    return;
  }

  const button =
    document.getElementById("setup-button");

  button.disabled = true;
  button.textContent = "作成中…";

  try {
    const user = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name,
        className
      })
    });

    me = user;

    localStorage.setItem(
      meKey,
      JSON.stringify(me)
    );

    connectSocket();

    await loadFriends();
    await loadFriendRequests();

    showMain();

    showToast("morimoriへようこそ");
  } catch (error) {
    showToast(error.message);

    button.disabled = false;
    button.textContent = "はじめる";
  }
}

/* =========================
   Socket
========================= */

function connectSocket() {
  socket.emit("identify", me.id);
}

socket.on("connect", () => {
  if (me?.id) {
    socket.emit("identify", me.id);
  }
});

socket.on("message", message => {
  if (!currentChatUser) {
    loadFriends();
    return;
  }

  const related =
    message.from === currentChatUser.id ||
    message.to === currentChatUser.id;

  if (!related) {
    loadFriends();
    return;
  }

  const exists =
    messages.some(
      item => item.id === message.id
    );

  if (!exists) {
    messages.push(message);
  }

  renderMessages();

  if (message.to === me.id) {
    socket.emit("mark-read", {
      otherUserId: currentChatUser.id
    });
  }

  loadFriends();
});

socket.on("messages-read", () => {
  if (currentChatUser) {
    loadMessages(currentChatUser.id);
  }

  loadFriends();
});

socket.on("presence", data => {
  updateUserPresence(data);
});

socket.on("user-updated", user => {
  if (me?.id === user.id) {
    me = user;
    localStorage.setItem(
      meKey,
      JSON.stringify(me)
    );
  }

  updateCachedUser(user);

  if (currentChatUser?.id === user.id) {
    currentChatUser = user;
    renderChatHeader();
  }

  renderFriends();
});

socket.on("friend-request", async data => {
  friendRequestCount++;

  showToast(
    `${data?.fromUser?.name || "ユーザー"}から友達申請`
  );

  if ("Notification" in window &&
      Notification.permission === "granted") {
    try {
      new Notification("morimori", {
        body:
          `${data?.fromUser?.name || "ユーザー"}から友達申請が届きました`
      });
    } catch {}
  }

  await loadFriendRequests();
  renderMain();
});

socket.on("friend-added", async data => {
  showToast(
    `${data?.user?.name || "ユーザー"}と友達になりました`
  );

  await loadFriends();
  renderMain();
});

socket.on("friend-removed", async () => {
  await loadFriends();

  if (
    currentChatUser &&
    !friends.some(
      user => user.id === currentChatUser.id
    )
  ) {
    currentChatUser = null;
    showFriends();
  }
});

socket.on("new-message-notification", data => {
  if (
    currentChatUser &&
    data?.from?.id === currentChatUser.id
  ) {
    return;
  }

  const name =
    data?.from?.name || "メッセージ";

  showToast(`${name}から新しいメッセージ`);

  if (
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      new Notification(name, {
        body:
          data?.message?.text ||
          "新しいメッセージがあります"
      });
    } catch {}
  }

  loadFriends();
});

socket.on("reply-notification", data => {
  showToast(
    `${data?.from || "ユーザー"}があなたのメッセージに返信しました`
  );
});

socket.on("message-deleted", data => {
  messages = messages.map(message => {
    if (message.id === data.messageId) {
      return {
        ...message,
        deleted: true,
        text: ""
      };
    }

    return message;
  });

  renderMessages();
});

/* =========================
   データ取得
========================= */

async function loadFriends() {
  if (!me?.id) return;

  try {
    friends = await api(
      `/api/friends/${me.id}`
    );
  } catch {
    friends = [];
  }
}

async function loadFriendRequests() {
  if (!me?.id) return;

  try {
    const data = await api(
      `/api/friend-requests/${me.id}`
    );

    friendRequestCount =
      data.incoming?.length || 0;
  } catch {
    friendRequestCount = 0;
  }
}

async function loadUsers() {
  try {
    users = await api("/api/users");
  } catch {
    users = [];
  }
}

async function loadMessages(otherUserId) {
  try {
    messages = await api(
      `/api/messages/${me.id}/${otherUserId}`
    );
  } catch {
    messages = [];
  }

  renderMessages();

  socket.emit("mark-read", {
    otherUserId
  });

  await loadFriends();
}

/* =========================
   メインUI
========================= */

function showMain() {
  renderMain();
}

function renderMain() {
  if (currentScreen === "chat" && currentChatUser) {
    renderChatScreen();
    return;
  }

  if (currentScreen === "profile") {
    renderProfileScreen();
    return;
  }

  if (currentScreen === "friends") {
    renderFriendsScreen();
    return;
  }

  if (currentScreen === "requests") {
    renderRequestsScreen();
    return;
  }

  renderFriendsScreen();
}

/* =========================
   友達画面
========================= */

function renderFriendsScreen() {
  currentScreen = "friends";

  app.innerHTML = `
    <div class="app-shell">

      <header class="topbar">
        <div>
          <div class="topbar-title">友達</div>
          <div class="topbar-subtitle">
            ${escapeHtml(me?.name || "")}
          </div>
        </div>

        <div class="topbar-actions">
          <button
            class="icon-button"
            id="search-friends-button"
            title="検索"
          >⌕</button>

          <button
            class="icon-button"
            id="profile-button"
            title="プロフィール"
          >◉</button>
        </div>
      </header>

      <main class="main-content">
        <div class="friend-tools">
          <button
            class="add-friend-button"
            id="add-friend-button"
          >
            ＋ 友達を追加
          </button>

          ${
            friendRequestCount > 0
              ? `
                <button
                  class="request-button"
                  id="requests-button"
                >
                  友達申請
                  <span class="badge">
                    ${friendRequestCount}
                  </span>
                </button>
              `
              : ""
          }
        </div>

        <div id="friends-content"></div>
      </main>

      ${bottomNavigation("friends")}

    </div>
  `;

  document
    .getElementById("add-friend-button")
    .addEventListener(
      "click",
      showAddFriendScreen
    );

  document
    .getElementById("profile-button")
    .addEventListener(
      "click",
      showProfile
    );

  document
    .getElementById("search-friends-button")
    .addEventListener(
      "click",
      showFriendSearch
    );

  document
    .getElementById("requests-button")
    ?.addEventListener(
      "click",
      showRequests
    );

  renderFriends();
}

function renderFriends() {
  const container =
    document.getElementById(
      "friends-content"
    );

  if (!container) return;

  const favoriteFriends =
    friends.filter(
      friend => friend.favorite
    );

  const recentFriends =
    friends.filter(
      friend => !friend.favorite
    );

  container.innerHTML = `
    ${
      favoriteFriends.length
        ? `
          <section class="friend-section">
            <div class="section-title">
              ⭐ お気に入り
            </div>

            <div class="friend-list">
              ${favoriteFriends
                .map(friendCard)
                .join("")}
            </div>
          </section>
        `
        : ""
    }

    <section class="friend-section">
      <div class="section-title">
        ${
          favoriteFriends.length
            ? "最近のやりとり"
            : "友達"
        }
      </div>

      ${
        recentFriends.length
          ? `
            <div class="friend-list">
              ${recentFriends
                .map(friendCard)
                .join("")}
            </div>
          `
          : `
            <div class="empty-state">
              <div class="empty-icon">👥</div>
              <div>まだ友達がいません</div>
              <button
                class="primary-button small"
                id="empty-add-friend"
              >
                友達を追加
              </button>
            </div>
          `
      }
    </section>
  `;

  container
    .querySelectorAll(".friend-card")
    .forEach(card => {
      card.addEventListener("click", () => {
        const user =
          friends.find(
            friend =>
              friend.id === card.dataset.id
          );

        if (user) {
          openChat(user);
        }
      });
    });

  document
    .getElementById("empty-add-friend")
    ?.addEventListener(
      "click",
      showAddFriendScreen
    );
}

function friendCard(friend) {
  const unread =
    Number(friend.unread || 0);

  return `
    <button
      class="friend-card"
      data-id="${escapeHtml(friend.id)}"
    >
      ${avatarHtml(friend)}

      <div class="friend-info">
        <div class="friend-name-row">
          <span class="friend-name">
            ${escapeHtml(friend.name)}
          </span>

          ${
            friend.online
              ? `<span class="online-dot"></span>`
              : ""
          }

          ${
            friend.favorite
              ? `<span class="favorite-star">★</span>`
              : ""
          }
        </div>

        <div class="friend-class">
          ${escapeHtml(friend.className)}
        </div>
      </div>

      <div class="friend-meta">
        ${
          friend.lastMessageAt
            ? `
              <div class="last-time">
                ${formatTime(
                  friend.lastMessageAt
                )}
              </div>
            `
            : ""
        }

        ${
          unread
            ? `
              <div class="unread-badge">
                ${unread > 99 ? "99+" : unread}
              </div>
            `
            : ""
        }
      </div>
    </button>
  `;
}

/* =========================
   友達追加
========================= */

async function showAddFriendScreen() {
  currentScreen = "add-friend";

  await loadUsers();

  app.innerHTML = `
    <div class="app-shell">

      <header class="chat-header">
        <button
          class="back-button"
          id="back-friends"
        >
          ←
        </button>

        <div>
          <div class="chat-title">
            友達を追加
          </div>
        </div>
      </header>

      <main class="main-content">
        <div class="search-box">
          <input
            id="user-search"
            type="search"
            placeholder="名前・クラスで検索"
            autocomplete="off"
          >
        </div>

        <div
          class="user-search-results"
          id="user-search-results"
        ></div>
      </main>

    </div>
  `;

  document
    .getElementById("back-friends")
    .addEventListener(
      "click",
      showFriends
    );

  document
    .getElementById("user-search")
    .addEventListener(
      "input",
      renderUserSearch
    );

  renderUserSearch();
}

function renderUserSearch() {
  const input =
    document.getElementById(
      "user-search"
    );

  const container =
    document.getElementById(
      "user-search-results"
    );

  if (!input || !container) return;

  const keyword =
    input.value.trim().toLowerCase();

  const results =
    users.filter(user => {
      if (user.id === me.id) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return (
        user.name
          .toLowerCase()
          .includes(keyword) ||
        user.className
          .toLowerCase()
          .includes(keyword)
      );
    });

  container.innerHTML =
    results.length
      ? results
          .map(user => userSearchCard(user))
          .join("")
      : `
        <div class="empty-state">
          該当するユーザーがいません
        </div>
      `;

  container
    .querySelectorAll(
      ".user-search-card"
    )
    .forEach(card => {
      card.addEventListener(
        "click",
        () => {
          const user =
            users.find(
              item =>
                item.id ===
                card.dataset.id
            );

          if (user) {
            showUserProfile(user);
          }
        }
      );
    });
}

function userSearchCard(user) {
  const isFriend =
    friends.some(
      friend => friend.id === user.id
    );

  return `
    <button
      class="user-search-card"
      data-id="${escapeHtml(user.id)}"
    >
      ${avatarHtml(user)}

      <div class="friend-info">
        <div class="friend-name">
          ${escapeHtml(user.name)}
        </div>

        <div class="friend-class">
          ${escapeHtml(user.className)}
        </div>
      </div>

      <div class="search-card-status">
        ${
          isFriend
            ? "友達"
            : "›"
        }
      </div>
    </button>
  `;
}

/* =========================
   ユーザープロフィール
========================= */

function showUserProfile(user) {
  const isFriend =
    friends.some(
      friend => friend.id === user.id
    );

  app.innerHTML = `
    <div class="app-shell">

      <header class="chat-header">
        <button
          class="back-button"
          id="back-user-search"
        >
          ←
        </button>

        <div class="chat-title">
          プロフィール
        </div>
      </header>

      <main class="profile-content">

        <div class="profile-card">

          ${avatarHtml(user, "large")}

          <h2>
            ${escapeHtml(user.name)}
          </h2>

          <div class="profile-class">
            ${escapeHtml(user.className)}
          </div>

          <div class="profile-status">
            ${
              user.online
                ? "🟢 オンライン"
                : "オフライン"
            }
          </div>

          ${
            isFriend
              ? `
                <button
                  class="primary-button"
                  id="profile-chat"
                >
                  チャット
                </button>
              `
              : `
                <button
                  class="primary-button"
                  id="send-friend-request"
                >
                  ＋ 友達追加
                </button>
              `
          }

        </div>

      </main>

    </div>
  `;

  document
    .getElementById("back-user-search")
    .addEventListener(
      "click",
      showAddFriendScreen
    );

  if (isFriend) {
    document
      .getElementById("profile-chat")
      .addEventListener(
        "click",
        () => openChat(user)
      );
  } else {
    document
      .getElementById(
        "send-friend-request"
      )
      .addEventListener(
        "click",
        () => sendFriendRequest(user)
      );
  }
}

async function sendFriendRequest(user) {
  try {
    await api(
      "/api/friend-requests",
      {
        method: "POST",
        body: JSON.stringify({
          from: me.id,
          to: user.id
        })
      }
    );

    showToast("友達申請を送りました");

    setTimeout(
      showAddFriendScreen,
      500
    );
  } catch (error) {
    showToast(error.message);
  }
}

/* =========================
   申請
========================= */

async function showRequests() {
  currentScreen = "requests";

  let data;

  try {
    data = await api(
      `/api/friend-requests/${me.id}`
    );
  } catch {
    data = {
      incoming: [],
      outgoing: []
    };
  }

  app.innerHTML = `
    <div class="app-shell">

      <header class="chat-header">
        <button
          class="back-button"
          id="back-requests"
        >
          ←
        </button>

        <div class="chat-title">
          友達申請
        </div>
      </header>

      <main class="main-content">

        <section class="friend-section">
          <div class="section-title">
            届いた申請
          </div>

          <div id="incoming-requests">
            ${
              data.incoming.length
                ? data.incoming
                    .map(
                      requestCard
                    )
                    .join("")
                : `
                  <div class="empty-state small-empty">
                    申請はありません
                  </div>
                `
            }
          </div>
        </section>

        <section class="friend-section">
          <div class="section-title">
            送った申請
          </div>

          <div>
            ${
              data.outgoing.length
                ? data.outgoing
                    .map(
                      outgoingRequestCard
                    )
                    .join("")
                : `
                  <div class="empty-state small-empty">
                    送信中の申請はありません
                  </div>
                `
            }
          </div>
        </section>

      </main>

    </div>
  `;

  document
    .getElementById("back-requests")
    .addEventListener(
      "click",
      showFriends
    );

  document
    .querySelectorAll(
      "[data-request-action]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        async () => {
          const requestId =
            button.dataset.requestId;

          const action =
            button.dataset.requestAction;

          await handleFriendRequest(
            requestId,
            action
          );
        }
      );
    });
}

function requestCard(request) {
  const user =
    request.fromUser;

  return `
    <div class="request-card">
      ${avatarHtml(user)}

      <div class="friend-info">
        <div class="friend-name">
          ${escapeHtml(user?.name)}
        </div>

        <div class="friend-class">
          ${escapeHtml(user?.className)}
        </div>
      </div>

      <div class="request-actions">
        <button
          class="accept-button"
          data-request-id="${request.id}"
          data-request-action="accept"
        >
          承認
        </button>

        <button
          class="reject-button"
          data-request-id="${request.id}"
          data-request-action="reject"
        >
          拒否
        </button>
      </div>
    </div>
  `;
}

function outgoingRequestCard(request) {
  const user =
    request.toUser;

  return `
    <div class="request-card">
      ${avatarHtml(user)}

      <div class="friend-info">
        <div class="friend-name">
          ${escapeHtml(user?.name)}
        </div>

        <div class="friend-class">
          ${escapeHtml(user?.className)}
        </div>
      </div>

      <div class="request-pending">
        申請中
      </div>
    </div>
  `;
}

async function handleFriendRequest(
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

    await loadFriendRequests();
    await loadFriends();

    showRequests();
  } catch (error) {
    showToast(error.message);
  }
}

/* =========================
   チャット
========================= */

async function openChat(user) {
  currentChatUser = user;
  currentScreen = "chat";
  replyTarget = null;

  renderChatScreen();

  await loadMessages(user.id);
}

function renderChatScreen() {
  app.innerHTML = `
    <div class="app-shell chat-shell">

      <header
        class="chat-header"
        id="chat-header"
      >
        <button
          class="back-button"
          id="chat-back"
        >
          ←
        </button>

        <button
          class="chat-user-button"
          id="chat-user-profile"
        >
          ${avatarHtml(currentChatUser)}

          <div class="chat-user-info">
            <div class="chat-title">
              ${escapeHtml(
                currentChatUser?.name
              )}
            </div>

            <div
              class="chat-presence"
              id="chat-presence"
            >
              ${
                currentChatUser?.online
                  ? "オンライン"
                  : escapeHtml(
                      currentChatUser?.className ||
                      ""
                    )
              }
            </div>
          </div>
        </button>

        <div class="chat-actions">
          <button
            class="icon-button"
            title="音声通話"
            id="voice-call"
          >
            ☎
          </button>

          <button
            class="icon-button"
            title="ビデオ通話"
            id="video-call"
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
        class="reply-preview"
        id="reply-preview"
        hidden
      ></div>

      <div class="composer">

        <button
          class="composer-plus"
          id="composer-plus"
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
          class="send-button"
          id="send-button"
        >
          ↑
        </button>

      </div>

    </div>
  `;

  document
    .getElementById("chat-back")
    .addEventListener(
      "click",
      showFriends
    );

  document
    .getElementById(
      "chat-user-profile"
    )
    .addEventListener(
      "click",
      () => {
        showUserProfile(
          currentChatUser
        );
      }
    );

  document
    .getElementById("send-button")
    .addEventListener(
      "click",
      sendMessage
    );

  document
    .getElementById("message-input")
    .addEventListener(
      "keydown",
      handleMessageKeydown
    );

  document
    .getElementById("message-input")
    .addEventListener(
      "input",
      autoResizeTextarea
    );

  document
    .getElementById("composer-plus")
    .addEventListener(
      "click",
      () => {
        showToast(
          "画像・ファイル送信は次の機能として追加できます"
        );
      }
    );

  document
    .getElementById("voice-call")
    .addEventListener(
      "click",
      () => {
        showToast(
          "音声通話機能を準備中です"
        );
      }
    );

  document
    .getElementById("video-call")
    .addEventListener(
      "click",
      () => {
        showToast(
          "ビデオ通話機能を準備中です"
        );
      }
    );

  renderMessages();
  renderReplyPreview();
}

function renderChatHeader() {
  const header =
    document.getElementById(
      "chat-header"
    );

  if (!header || !currentChatUser) {
    return;
  }

  const userButton =
    document.getElementById(
      "chat-user-profile"
    );

  if (!userButton) return;

  userButton.innerHTML = `
    ${avatarHtml(currentChatUser)}

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
            : escapeHtml(
                currentChatUser.className
              )
        }
      </div>
    </div>
  `;
}

function renderMessages() {
  const container =
    document.getElementById(
      "messages"
    );

  if (!container) return;

  if (!messages.length) {
    container.innerHTML = `
      <div class="chat-empty">
        <div class="chat-empty-avatar">
          ${avatarHtml(
            currentChatUser,
            "large"
          )}
        </div>

        <div class="chat-empty-name">
          ${escapeHtml(
            currentChatUser?.name
          )}
        </div>

        <div class="chat-empty-text">
          メッセージを送ってみよう
        </div>
      </div>
    `;

    return;
  }

  container.innerHTML = messages
    .map(messageHtml)
    .join("");

  container
    .querySelectorAll(
      "[data-reply-message]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const id =
            button.dataset.replyMessage;

          const message =
            messages.find(
              item => item.id === id
            );

          if (message) {
            setReplyTarget(message);
          }
        }
      );
    });

  container
    .querySelectorAll(
      "[data-delete-message]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        () => {
          deleteMessage(
            button.dataset.deleteMessage
          );
        }
      );
    });

  container.scrollTop =
    container.scrollHeight;
}

function messageHtml(message) {
  const mine =
    message.from === me.id;

  const deleted =
    message.deleted;

  const replied =
    message.replyTo
      ? messages.find(
          item =>
            item.id === message.replyTo
        )
      : null;

  return `
    <div
      class="
        message-row
        ${mine ? "mine" : "theirs"}
      "
    >
      <div
        class="message-bubble"
        data-message-id="${message.id}"
      >

        ${
          replied
            ? `
              <div class="reply-reference">
                <div class="reply-reference-name">
                  ${
                    replied.from === me.id
                      ? "自分"
                      : escapeHtml(
                          currentChatUser?.name
                        )
                  }
                </div>

                <div class="reply-reference-text">
                  ${
                    replied.deleted
                      ? "削除されたメッセージ"
                      : escapeHtml(
                          replied.text
                        )
                  }
                </div>
              </div>
            `
            : ""
        }

        <div class="message-text ${
          deleted ? "deleted" : ""
        }">
          ${
            deleted
              ? "メッセージを削除しました"
              : escapeHtml(
                  message.text
                ).replace(
                  /\n/g,
                  "<br>"
                )
          }
        </div>

        <div class="message-bottom">
          <span class="message-time">
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
                      : "未読"
                  }
                </span>
              `
              : ""
          }
        </div>

        ${
          !deleted
            ? `
              <div class="message-actions">

                <button
                  data-reply-message="${message.id}"
                  title="返信"
                >
                  ↩
                </button>

                <button
                  onclick="
                    navigator.clipboard?.writeText(
                      ${JSON.stringify(
                        message.text
                      )}
                    );
                    showToast('コピーしました');
                  "
                  title="コピー"
                >
                  ⧉
                </button>

                ${
                  mine
                    ? `
                      <button
                        data-delete-message="${message.id}"
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

function handleMessageKeydown(event) {
  if (event.key !== "Enter") {
    return;
  }

  if (event.shiftKey) {
    return;
  }

  if (event.isComposing) {
    return;
  }

  event.preventDefault();

  sendMessage();
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

function sendMessage() {
  const input =
    document.getElementById(
      "message-input"
    );

  if (!input || !currentChatUser) {
    return;
  }

  const text =
    input.value;

  if (!text.trim()) {
    return;
  }

  socket.emit(
    "send-message",
    {
      to: currentChatUser.id,
      text,
      replyTo:
        replyTarget?.id || null
    }
  );

  input.value = "";
  input.style.height = "auto";

  replyTarget = null;

  renderReplyPreview();
}

function setReplyTarget(message) {
  replyTarget = message;

  renderReplyPreview();

  const input =
    document.getElementById(
      "message-input"
    );

  input?.focus();
}

function renderReplyPreview() {
  const preview =
    document.getElementById(
      "reply-preview"
    );

  if (!preview) return;

  if (!replyTarget) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }

  preview.hidden = false;

  preview.innerHTML = `
    <div>
      <div class="reply-preview-title">
        返信
      </div>

      <div class="reply-preview-text">
        ${escapeHtml(
          replyTarget.text
        )}
      </div>
    </div>

    <button id="cancel-reply">
      ×
    </button>
  `;

  document
    .getElementById("cancel-reply")
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

    messages = messages.map(
      message => {
        if (
          message.id === messageId
        ) {
          return {
            ...message,
            deleted: true,
            text: ""
          };
        }

        return message;
      }
    );

    renderMessages();
  } catch (error) {
    showToast(error.message);
  }
}

/* =========================
   プロフィール
========================= */

function showProfile() {
  currentScreen = "profile";
  renderProfileScreen();
}

function renderProfileScreen() {
  app.innerHTML = `
    <div class="app-shell">

      <header class="chat-header">
        <button
          class="back-button"
          id="profile-back"
        >
          ←
        </button>

        <div class="chat-title">
          プロフィール
        </div>
      </header>

      <main class="profile-content">

        <div class="profile-card">

          <button
            class="profile-avatar-button"
            id="change-icon"
          >
            ${avatarHtml(
              me,
              "large"
            )}

            <span class="avatar-edit">
              ✎
            </span>
          </button>

          <label class="profile-field">
            <span>名前</span>

            <input
              id="profile-name"
              value="${escapeHtml(
                me.name
              )}"
              maxlength="40"
            >
          </label>

          <label class="profile-field">
            <span>クラス</span>

            <input
              id="profile-class"
              value="${escapeHtml(
                me.className
              )}"
              maxlength="30"
            >
          </label>

          <button
            class="primary-button"
            id="save-profile"
          >
            保存
          </button>

          <input
            type="file"
            id="icon-file"
            accept="image/*"
            hidden
          >

        </div>

      </main>

      ${bottomNavigation("profile")}

    </div>
  `;

  document
    .getElementById("profile-back")
    .addEventListener(
      "click",
      showFriends
    );

  document
    .getElementById("change-icon")
    .addEventListener(
      "click",
      () => {
        document
          .getElementById("icon-file")
          .click();
      }
    );

  document
    .getElementById("icon-file")
    .addEventListener(
      "change",
      handleIconChange
    );

  document
    .getElementById("save-profile")
    .addEventListener(
      "click",
      saveProfile
    );
}

let selectedIcon = null;

function handleIconChange(event) {
  const file =
    event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("画像を選択してください");
    return;
  }

  const reader =
    new FileReader();

  reader.onload = () => {
    selectedIcon =
      reader.result;

    const button =
      document.getElementById(
        "change-icon"
      );

    if (button) {
      button.innerHTML = `
        <div class="avatar large">
          <img
            src="${escapeHtml(
              selectedIcon
            )}"
            alt=""
          >
        </div>

        <span class="avatar-edit">
          ✎
        </span>
      `;
    }
  };

  reader.readAsDataURL(file);
}

async function saveProfile() {
  const name =
    document.getElementById(
      "profile-name"
    )?.value.trim();

  const className =
    document.getElementById(
      "profile-class"
    )?.value.trim();

  if (!name || !className) {
    showToast(
      "名前とクラスを入力してください"
    );
    return;
  }

  const button =
    document.getElementById(
      "save-profile"
    );

  button.disabled = true;
  button.textContent = "保存中…";

  try {
    const updated =
      await api(
        `/api/users/${me.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name,
            className,
            icon:
              selectedIcon ??
              me.icon ??
              null
          })
        }
      );

    me = updated;

    localStorage.setItem(
      meKey,
      JSON.stringify(me)
    );

    selectedIcon = null;

    await loadFriends();

    showToast("プロフィールを更新しました");

    setTimeout(
      showFriends,
      500
    );
  } catch (error) {
    showToast(error.message);

    button.disabled = false;
    button.textContent = "保存";
  }
}

/* =========================
   友達検索
========================= */

async function showFriendSearch() {
  currentScreen = "friend-search";

  await loadFriends();

  app.innerHTML = `
    <div class="app-shell">

      <header class="chat-header">
        <button
          class="back-button"
          id="search-back"
        >
          ←
        </button>

        <div class="chat-title">
          友達を検索
        </div>
      </header>

      <main class="main-content">

        <div class="search-box">
          <input
            id="friend-search-input"
            type="search"
            placeholder="友達の名前・クラス"
            autocomplete="off"
          >
        </div>

        <div
          id="friend-search-results"
          class="friend-list"
        ></div>

      </main>

    </div>
  `;

  document
    .getElementById("search-back")
    .addEventListener(
      "click",
      showFriends
    );

  document
    .getElementById(
      "friend-search-input"
    )
    .addEventListener(
      "input",
      renderFriendSearch
    );

  renderFriendSearch();
}

function renderFriendSearch() {
  const input =
    document.getElementById(
      "friend-search-input"
    );

  const container =
    document.getElementById(
      "friend-search-results"
    );

  if (!input || !container) {
    return;
  }

  const keyword =
    input.value.trim().toLowerCase();

  const result =
    friends.filter(friend => {
      if (!keyword) return true;

      return (
        friend.name
          .toLowerCase()
          .includes(keyword) ||
        friend.className
          .toLowerCase()
          .includes(keyword)
      );
    });

  container.innerHTML =
    result.length
      ? result
          .map(friendCard)
          .join("")
      : `
        <div class="empty-state">
          見つかりません
        </div>
      `;

  container
    .querySelectorAll(".friend-card")
    .forEach(card => {
      card.addEventListener(
        "click",
        () => {
          const user =
            friends.find(
              friend =>
                friend.id ===
                card.dataset.id
            );

          if (user) {
            openChat(user);
          }
        }
      );
    });
}

/* =========================
   ナビゲーション
========================= */

function bottomNavigation(active) {
  return `
    <nav class="bottom-nav">

      <button
        class="nav-item ${
          active === "friends"
            ? "active"
            : ""
        }"
        id="nav-friends"
      >
        <span>👥</span>
        <small>友達</small>
      </button>

      <button
        class="nav-item"
        id="nav-add"
      >
        <span>＋</span>
        <small>追加</small>
      </button>

      <button
        class="nav-item ${
          active === "profile"
            ? "active"
            : ""
        }"
        id="nav-profile"
      >
        <span>◉</span>
        <small>設定</small>
      </button>

    </nav>
  `;
}

document.addEventListener(
  "click",
  event => {
    if (
      event.target.closest(
        "#nav-friends"
      )
    ) {
      showFriends();
    }

    if (
      event.target.closest(
        "#nav-add"
      )
    ) {
      showAddFriendScreen();
    }

    if (
      event.target.closest(
        "#nav-profile"
      )
    ) {
      showProfile();
    }
  }
);

/* =========================
   画面遷移
========================= */

async function showFriends() {
  currentScreen = "friends";
  currentChatUser = null;
  replyTarget = null;

  await loadFriends();
  await loadFriendRequests();

  renderFriendsScreen();
}

/* =========================
   ユーザー情報更新
========================= */

function updateCachedUser(user) {
  users = users.map(
    item =>
      item.id === user.id
        ? {
            ...item,
            ...user
          }
        : item
  );

  friends = friends.map(
    item =>
      item.id === user.id
        ? {
            ...item,
            ...user
          }
        : item
  );
}

function updateUserPresence(data) {
  updateCachedUser({
    id: data.userId,
    online: data.online,
    lastOnline: data.lastOnline
  });

  if (
    currentChatUser?.id ===
    data.userId
  ) {
    currentChatUser = {
      ...currentChatUser,
      online: data.online,
      lastOnline: data.lastOnline
    };

    renderChatHeader();
  }

  renderFriends();
}

/* =========================
   通知
========================= */

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
    } catch {}
  }
}

requestNotificationPermission();

/* =========================
   起動
========================= */

init();
