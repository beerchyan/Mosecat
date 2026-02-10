import {
  CONNECTION_STATUS,
  addNotice,
  getState,
  resetGameView,
  setActionPayloadText,
  setAutoReconnect,
  setNickname,
  setScreen,
  subscribe
} from "./state.js";

const STATUS_TEXT = {
  [CONNECTION_STATUS.CONNECTING]: "CONNECTING",
  [CONNECTION_STATUS.CONNECTED]: "CONNECTED",
  [CONNECTION_STATUS.DISCONNECTED]: "DISCONNECTED"
};

export function setupUI(wsClient) {
  const refs = collectRefs();
  bindEvents(refs, wsClient);
  subscribe((state) => render(state, refs));
}

function collectRefs() {
  return {
    homeScreen: document.getElementById("homeScreen"),
    gameScreen: document.getElementById("gameScreen"),
    nicknameInput: document.getElementById("nicknameInput"),
    startGameBtn: document.getElementById("startGameBtn"),
    backHomeBtn: document.getElementById("backHomeBtn"),
    reconnectBtn: document.getElementById("reconnectBtn"),
    autoReconnectInput: document.getElementById("autoReconnectInput"),
    quickActions: document.getElementById("quickActions"),
    customActionType: document.getElementById("customActionType"),
    actionPayloadInput: document.getElementById("actionPayloadInput"),
    sendActionBtn: document.getElementById("sendActionBtn"),
    connectionStatusBadge: document.getElementById("connectionStatusBadge"),
    connectionValue: document.getElementById("connectionValue"),
    scoreValue: document.getElementById("scoreValue"),
    roundValue: document.getElementById("roundValue"),
    resultValue: document.getElementById("resultValue"),
    stageHintText: document.getElementById("stageHintText"),
    noticeList: document.getElementById("noticeList"),
    gameStateDump: document.getElementById("gameStateDump"),
    gameCanvas: document.getElementById("gameCanvas")
  };
}

function bindEvents(refs, wsClient) {
  refs.startGameBtn.addEventListener("click", () => {
    const nickname = refs.nicknameInput.value.trim() || "Guest";
    setNickname(nickname);
    setScreen("game");
    addNotice("system", `玩家 ${nickname} 已进入游戏`);
    wsClient.connect(nickname);
  });

  refs.nicknameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      refs.startGameBtn.click();
    }
  });

  refs.backHomeBtn.addEventListener("click", () => {
    wsClient.disconnect();
    setScreen("home");
    resetGameView();
    addNotice("system", "已返回首页");
  });

  refs.reconnectBtn.addEventListener("click", () => {
    wsClient.reconnect();
  });

  refs.autoReconnectInput.addEventListener("change", () => {
    const checked = refs.autoReconnectInput.checked;
    setAutoReconnect(checked);
    addNotice("system", checked ? "已开启自动重连" : "已关闭自动重连");
  });

  refs.quickActions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;
    wsClient.sendPlayerAction(action, {});
    addNotice("system", `发送动作: ${action}`);
  });

  refs.actionPayloadInput.addEventListener("input", () => {
    setActionPayloadText(refs.actionPayloadInput.value);
  });

  refs.sendActionBtn.addEventListener("click", () => {
    const actionType = refs.customActionType.value;
    const payloadText = refs.actionPayloadInput.value.trim();
    let payload = {};

    try {
      payload = payloadText ? JSON.parse(payloadText) : {};
    } catch (_) {
      addNotice("error", "payload 不是有效 JSON");
      return;
    }

    wsClient.sendPlayerAction(actionType, payload);
    addNotice("system", `发送动作: ${actionType}`);
  });
}

function render(state, refs) {
  const isHome = state.screen === "home";
  refs.homeScreen.classList.toggle("active", isHome);
  refs.gameScreen.classList.toggle("active", !isHome);

  if (document.activeElement !== refs.nicknameInput) {
    refs.nicknameInput.value = state.player.nickname;
  }
  if (document.activeElement !== refs.actionPayloadInput) {
    refs.actionPayloadInput.value = state.game.actionPayloadText;
  }
  refs.autoReconnectInput.checked = state.connection.autoReconnect;

  renderConnection(state, refs);
  renderServerState(state, refs);
  renderNotices(state, refs.noticeList);
  drawCanvas(refs.gameCanvas, state.game.serverState, state.connection.status);
}

function renderConnection(state, refs) {
  const status = state.connection.status;
  const text = STATUS_TEXT[status] || STATUS_TEXT.disconnected;

  refs.connectionStatusBadge.classList.remove("connecting", "connected", "disconnected");
  refs.connectionStatusBadge.classList.add(status);
  refs.connectionStatusBadge.textContent = text;
  refs.connectionValue.textContent = text;
}

function renderServerState(state, refs) {
  const serverState = state.game.serverState;
  const score = getByKeys(serverState, ["score", "points", "playerScore"], "--");
  const round = getByKeys(serverState, ["round", "turn", "step"], "--");
  const result = getByKeys(serverState, ["result", "status", "phase"], "等待中");
  const hint = getByKeys(serverState, ["hint", "notice", "message"], state.game.hint);

  refs.scoreValue.textContent = stringifyStatusValue(score);
  refs.roundValue.textContent = stringifyStatusValue(round);
  refs.resultValue.textContent = stringifyStatusValue(result);
  refs.stageHintText.textContent = stringifyStatusValue(hint);
  refs.gameStateDump.textContent = serverState
    ? JSON.stringify(serverState, null, 2)
    : JSON.stringify({}, null, 2);
}

function renderNotices(state, noticeList) {
  noticeList.innerHTML = "";

  const notices = state.notices.length ? state.notices : [{
    id: "placeholder",
    level: "notice",
    text: "暂无日志",
    createdAt: new Date().toISOString()
  }];

  for (const item of notices.slice(0, 12)) {
    const li = document.createElement("li");
    li.className = "notice-item";
    li.innerHTML = `
      <span class="notice-time">${formatTime(item.createdAt)}</span>
      <span class="notice-level ${item.level}">${item.level}</span>
      <span>${escapeHtml(item.text)}</span>
    `;
    noticeList.appendChild(li);
  }
}

function drawCanvas(canvas, serverState, connectionStatus) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const cols = 12;
  const rows = 8;
  const cellW = width / cols;
  const cellH = height / rows;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0a1f39");
  bg.addColorStop(1, "#0e2f52");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(143, 176, 214, 0.22)";
  for (let c = 0; c <= cols; c += 1) {
    ctx.beginPath();
    ctx.moveTo(c * cellW, 0);
    ctx.lineTo(c * cellW, height);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r += 1) {
    ctx.beginPath();
    ctx.moveTo(0, r * cellH);
    ctx.lineTo(width, r * cellH);
    ctx.stroke();
  }

  const entities = Array.isArray(serverState?.entities) ? serverState.entities : [];
  for (const entity of entities) {
    const x = normalizeToGrid(entity.x, cols) * cellW + cellW / 2;
    const y = normalizeToGrid(entity.y, rows) * cellH + cellH / 2;
    const radius = Math.max(10, Math.min(cellW, cellH) * 0.3);

    ctx.fillStyle = entity.color || "#ff9c4d";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (entity.label) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px 'Exo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(entity.label), x, y - radius - 6);
    }
  }

  const info = connectionStatus === CONNECTION_STATUS.CONNECTED
    ? "CONNECTED"
    : "WAITING FOR SERVER";
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = "18px 'Exo 2', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(info, 18, height - 22);
}

function getByKeys(source, keys, fallback) {
  if (!source || typeof source !== "object") {
    return fallback;
  }
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return fallback;
}

function stringifyStatusValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function normalizeToGrid(value, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  if (num >= 0 && num <= 1) {
    return Math.floor(num * (max - 1));
  }
  return Math.max(0, Math.min(max - 1, Math.floor(num)));
}

function formatTime(isoText) {
  const date = new Date(isoText);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
