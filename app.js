const app = document.querySelector("#app");
let socket;
let me = JSON.parse(localStorage.getItem("school-link-me") || "null");
let users = [];
let activeUser = null;
let chatMessages = [];
let replyTarget = null;
let composing = false;

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));

function avatar(user) {
  return user?.icon
    ? `<img src="${esc(user.icon)}" alt="">`
    : `<span>${esc((user?.name || "?").slice(0,1))}</span>`;
}

function time(ts) {
  return new Date(ts).toLocaleTimeString("ja-JP", {hour:"2-digit", minute:"2-digit"});
}

async function loadUsers() {
  users = await fetch("/api/users").then(r => r.json());
}

function render() {
  if (!me) return renderSetup();

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">SL</div>
          <div><b>SCHOOL LINK</b><small>School communication</small></div>
        </div>
        <div class="me-card">
          <div class="avatar">${avatar(me)}</div>
          <div><b>${esc(me.name)}</b><small>${esc(me.className)}</small></div>
        </div>
        <div class="section-title">ユーザー</div>
        <div id="user-list" class="user-list"></div>
        <div class="sidebar-note">学校で利用が許可された端末・ネットワークで使用してください。</div>
      </aside>

      <main class="main">
        <div id="chat"></div>
      </main>

      <nav class="mobile-nav">
        <button class="active">チャット</button>
        <button>クラス</button>
        <button>掲示板</button>
      </nav>
    </div>
  `;

  renderUsers();
  renderChat();
}

function renderSetup() {
  app.innerHTML = `
    <div class="setup">
      <div class="setup-card">
        <div class="brand centered">
          <div class="brand-mark">SL</div>
          <div><b>SCHOOL LINK</b><small>School communication</small></div>
        </div>
        <h1>はじめよう</h1>
        <p>名前とクラスだけで開始できます。</p>
        <label>表示名<input id="name" maxlength="40" autocomplete="name" placeholder="例：田中"></label>
        <label>クラス<input id="class" maxlength="30" placeholder="例：1年3組"></label>
        <button id="start" class="primary">SCHOOL LINKを開始</button>
      </div>
    </div>
  `;

  document.querySelector("#start").onclick = async () => {
    const name = document.querySelector("#name").value.trim();
    const className = document.querySelector("#class").value.trim();
    if (!name || !className) return alert("名前とクラスを入力してください。");

    me = await fetch("/api/users", {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({name, className})
    }).then(r => r.json());

    localStorage.setItem("school-link-me", JSON.stringify(me));
    connect();
    render();
  };
}

function renderUsers() {
  const list = document.querySelector("#user-list");
  const others = users.filter(u => u.id !== me.id);

  list.innerHTML = others.length ? others.map(u => `
    <button class="user-row ${activeUser?.id === u.id ? "selected" : ""}" data-id="${u.id}">
      <div class="avatar small">${avatar(u)}</div>
      <div class="user-info">
        <b>${esc(u.name)}</b>
        <small>${esc(u.className)}</small>
      </div>
      <i class="${u.online ? "online" : ""}"></i>
    </button>
  `).join("") : `<div class="empty-users">他のユーザーがまだいません。<br>別の端末で登録すると表示されます。</div>`;

  list.querySelectorAll(".user-row").forEach(btn => {
    btn.onclick = () => {
      activeUser = users.find(u => u.id === btn.dataset.id);
      replyTarget = null;
      loadChat();
    };
  });
}

async function loadChat() {
  chatMessages = await fetch(`/api/messages/${me.id}/${activeUser.id}`).then(r => r.json());
  render();
  markRead();
}

function renderChat() {
  const chat = document.querySelector("#chat");

  if (!activeUser) {
    chat.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">SL</div>
        <h2>SCHOOL LINK</h2>
        <p>左側から相手を選んでチャットを開始してください。</p>
      </div>
    `;
    return;
  }

  chat.innerHTML = `
    <header class="chat-header">
      <button class="back">‹</button>
      <div class="avatar">${avatar(activeUser)}</div>
      <div class="header-info">
        <b>${esc(activeUser.name)}</b>
        <small>${activeUser.online ? "🟢 オンライン" : "⚪ オフライン"}</small>
      </div>
      <div class="header-actions">
        <button title="音声通話">☎</button>
        <button title="ビデオ通話">▣</button>
      </div>
    </header>

    <section id="messages" class="messages">
      ${chatMessages.map(renderMessage).join("")}
    </section>

    <div id="reply-bar" class="reply-bar ${replyTarget ? "show" : ""}">
      <div><b>返信</b><span>${replyTarget ? esc(replyTarget.text) : ""}</span></div>
      <button id="cancel-reply">×</button>
    </div>

    <form id="composer" class="composer">
      <button type="button" id="plus" class="plus">＋</button>
      <textarea id="input" rows="1" placeholder="メッセージを入力" autocomplete="off"></textarea>
      <button type="submit" class="send">送信</button>
    </form>
  `;

  const messages = document.querySelector("#messages");
  messages.scrollTop = messages.scrollHeight;

  document.querySelector(".back").onclick = () => {
    activeUser = null;
    render();
  };

  document.querySelector("#cancel-reply").onclick = () => {
    replyTarget = null;
    renderChat();
    focusInput();
  };

  document.querySelector("#plus").onclick = () => {
    alert("画像・ファイル送信は次の実装段階で追加します。");
  };

  const input = document.querySelector("#input");

  input.addEventListener("compositionstart", () => composing = true);
  input.addEventListener("compositionend", () => composing = false);

  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !composing) {
      e.preventDefault();
      document.querySelector("#composer").requestSubmit();
    }
  });

  document.querySelector("#composer").onsubmit = e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    socket.emit("send-message", {
      to: activeUser.id,
      text,
      replyTo: replyTarget?.id || null
    });

    input.value = "";
    replyTarget = null;
    renderReplyOnly();
    input.focus();
  };

  document.querySelectorAll(".message-bubble").forEach(el => {
    el.addEventListener("contextmenu", e => {
      e.preventDefault();
      chooseReply(el.dataset.id);
    });
    el.addEventListener("dblclick", () => chooseReply(el.dataset.id));
  });
}

function renderMessage(m) {
  const mine = m.from === me.id;
  const original = m.replyTo ? chatMessages.find(x => x.id === m.replyTo) : null;

  return `
    <div class="message-line ${mine ? "mine" : "theirs"}">
      <div class="message-bubble" data-id="${m.id}">
        ${original ? `<div class="quoted">↩ ${esc(original.text.slice(0,80))}</div>` : ""}
        <div class="message-text">${esc(m.text).replace(/\n/g,"<br>")}</div>
        <div class="message-meta">${time(m.createdAt)} ${mine ? (m.read ? "既読" : "送信済み") : ""}</div>
      </div>
    </div>
  `;
}

function chooseReply(id) {
  const found = chatMessages.find(m => m.id === id);
  if (!found) return;
  replyTarget = found;
  renderReplyOnly();
  focusInput();
}

function renderReplyOnly() {
  const bar = document.querySelector("#reply-bar");
  if (!bar) return;
  bar.classList.toggle("show", !!replyTarget);
  bar.querySelector("span").textContent = replyTarget ? replyTarget.text : "";
}

function focusInput() {
  setTimeout(() => document.querySelector("#input")?.focus(), 0);
}

function markRead() {
  if (!activeUser) return;
  const unread = chatMessages.filter(m => m.to === me.id && !m.read);
  if (unread.length) {
    socket.emit("mark-read", {
      messageIds: unread.map(m => m.id),
      otherUserId: activeUser.id
    });
    unread.forEach(m => m.read = true);
  }
}

function connect() {
  socket = io();
  socket.on("connect", () => socket.emit("identify", me.id));

  socket.on("message", m => {
    if (!activeUser) return;
    if (m.roomId !== [me.id, activeUser.id].sort().join(":")) return;
    if (!chatMessages.some(x => x.id === m.id)) {
      chatMessages.push(m);
      renderChat();
      if (m.to === me.id) markRead();
    }
  });

  socket.on("presence", ({userId, online}) => {
    const u = users.find(x => x.id === userId);
    if (u) u.online = online;
    if (activeUser?.id === userId) activeUser.online = online;
    render();
  });

  socket.on("messages-read", ({messageIds}) => {
    const ids = new Set(messageIds);
    chatMessages.forEach(m => { if (ids.has(m.id)) m.read = true; });
    renderChat();
  });

  socket.on("reply-notification", data => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`${data.from}から返信`, {
        body: "あなたのメッセージに返信があります。"
      });
    }
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

(async () => {
  await loadUsers();
  if (me) {
    connect();
    render();
  } else {
    renderSetup();
  }

  if ("Notification" in window && Notification.permission === "default") {
    // ユーザー操作後に許可を求めるため、ここでは要求しない。
  }
})();