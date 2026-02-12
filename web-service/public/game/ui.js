import {
  CONNECTION_STATUS,
  addNotice,
  getState,
  resetGameView,
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
const GAME_DOT_COLOR = ["#5ad2ff", "#ff9c4d", "#8ef0a8", "#ffd95e", "#ee8cff", "#f77a7a"];

export function setupUI(wsClient) {
  const refs = collectRefs();
  const query = readQueryConfig();
  const runtime = {
    returnTimer: null,
    willReturnToRoom: false,
    hold: {
      action: "",
      timer: null,
      intervalMs: 2000
    }
  };
  if (query.nickname) {
    setNickname(query.nickname);
  }
  bindEvents(refs, wsClient, query, runtime);
  subscribe((state) => render(state, refs, runtime));
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

function bindEvents(refs, wsClient, query = {}, runtime) {
  const enterGame = () => {
    if (getState().screen === "game") {
      return;
    }
    clearScheduledReturn(runtime);
    const nickname = refs.nicknameInput.value.trim() || "Guest";
    setNickname(nickname);
    setScreen("game");
    addNotice("system", `玩家 ${nickname} 已进入游戏`);
    wsClient.connect(nickname);
  };

  refs.startGameBtn.addEventListener("click", enterGame);

  refs.nicknameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      enterGame();
    }
  });

  refs.backHomeBtn.addEventListener("click", () => {
    clearScheduledReturn(runtime);
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

  const stopHoldMove = () => {
    if (runtime?.hold?.timer) {
      clearTimeout(runtime.hold.timer);
      runtime.hold.timer = null;
    }
    if (runtime?.hold) {
      runtime.hold.action = "";
    }
  };
  const sendMoveAndSchedule = (action) => {
    if (!action || runtime.willReturnToRoom) {
      stopHoldMove();
      return;
    }
    wsClient.sendPlayerAction(action, {});
    runtime.hold.timer = setTimeout(
      () => sendMoveAndSchedule(action),
      runtime.hold.intervalMs
    );
  };
  const startHoldMove = (action) => {
    if (!action || runtime.willReturnToRoom || getState().screen !== "game") {
      return;
    }
    if (runtime.hold.action === action && runtime.hold.timer) {
      return;
    }
    stopHoldMove();
    runtime.hold.action = action;
    // 按下立即移动一次，然后按设定间隔持续移动
    sendMoveAndSchedule(action);
  };

  refs.quickActions.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    event.preventDefault();
    startHoldMove(button.dataset.action);
  });
  refs.quickActions.addEventListener("pointerup", stopHoldMove);
  refs.quickActions.addEventListener("pointercancel", stopHoldMove);
  refs.quickActions.addEventListener("pointerleave", stopHoldMove);

  window.addEventListener("keydown", (event) => {
    if (getState().screen !== "game") {
      return;
    }
    const targetTag = event.target && event.target.tagName ? String(event.target.tagName).toUpperCase() : "";
    if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT") {
      return;
    }
    if (event.repeat) {
      return;
    }
    const action = keyToAction(event.key);
    if (!action) {
      return;
    }
    event.preventDefault();
    startHoldMove(action);
  });
  window.addEventListener("keyup", (event) => {
    const action = keyToAction(event.key);
    if (!action) {
      return;
    }
    if (runtime.hold.action === action) {
      stopHoldMove();
    }
  });
  window.addEventListener("blur", stopHoldMove);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      stopHoldMove();
    }
  });

  if (query.autoStart) {
    requestAnimationFrame(() => {
      enterGame();
    });
  }
}

function readQueryConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    nickname: params.get("nickname") || "",
    autoStart: params.get("autostart") === "1"
  };
}

function render(state, refs, runtime) {
  const isHome = state.screen === "home";
  refs.homeScreen.classList.toggle("active", isHome);
  refs.gameScreen.classList.toggle("active", !isHome);

  if (document.activeElement !== refs.nicknameInput) {
    refs.nicknameInput.value = state.player.nickname;
  }
  refs.autoReconnectInput.checked = state.connection.autoReconnect;
  runtime.hold.intervalMs = Number(state.game.serverState?.move_interval_ms || 2000);

  renderConnection(state, refs);
  renderServerState(state, refs);
  renderNotices(state, refs.noticeList);
  drawCanvas(
    refs.gameCanvas,
    state.game.serverState,
    state.connection.status,
    getCurrentUsername()
  );
  handleGameOver(state, runtime);
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
  const players = Array.isArray(serverState?.players) ? serverState.players : [];
  const me = players.find((item) => item.username === getCurrentUsername()) || null;
  const score = me ? Number(me.moves || 0) : getByKeys(serverState, ["score", "points", "playerScore"], "--");
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

function drawCanvas(canvas, serverState, connectionStatus, currentUsername) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const mapRows = Array.isArray(serverState?.map) && serverState.map.length
    ? serverState.map
    : [];
  const rows = mapRows.length || 21;
  const cols = mapRows[0] ? String(mapRows[0]).length : 31;
  const cellSize = Math.max(1, Math.floor(Math.min(width / cols, height / rows)));
  const mapPixelWidth = cols * cellSize;
  const mapPixelHeight = rows * cellSize;
  const mapOffsetX = Math.floor((width - mapPixelWidth) / 2);
  const mapOffsetY = Math.floor((height - mapPixelHeight) / 2);

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0a1f39");
  bg.addColorStop(1, "#0e2f52");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const players = Array.isArray(serverState?.players) ? serverState.players : [];
  const selfPlayer = players.find((player) => player.username === currentUsername) || null;
  const visionRadius = Number(serverState?.vision_radius || 3);

  if (mapRows.length) {
    for (let y = 0; y < rows; y += 1) {
      const row = String(mapRows[y] || "");
      for (let x = 0; x < cols; x += 1) {
        const cell = row[x] || "#";
        ctx.fillStyle = cell === "#"
          ? "rgba(25, 40, 56, 0.95)"
          : "rgba(37, 89, 136, 0.22)";
        ctx.fillRect(
          mapOffsetX + x * cellSize,
          mapOffsetY + y * cellSize,
          cellSize,
          cellSize
        );
      }
    }

    ctx.strokeStyle = "rgba(103, 140, 176, 0.2)";
    for (let c = 0; c <= cols; c += 1) {
      ctx.beginPath();
      ctx.moveTo(mapOffsetX + c * cellSize, mapOffsetY);
      ctx.lineTo(mapOffsetX + c * cellSize, mapOffsetY + mapPixelHeight);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r += 1) {
      ctx.beginPath();
      ctx.moveTo(mapOffsetX, mapOffsetY + r * cellSize);
      ctx.lineTo(mapOffsetX + mapPixelWidth, mapOffsetY + r * cellSize);
      ctx.stroke();
    }
  }

  if (serverState?.end
    && Number.isFinite(serverState.end.x)
    && Number.isFinite(serverState.end.y)) {
    ctx.fillStyle = "rgba(255, 208, 72, 0.95)";
    ctx.fillRect(
      mapOffsetX + serverState.end.x * cellSize + cellSize * 0.2,
      mapOffsetY + serverState.end.y * cellSize + cellSize * 0.2,
      cellSize * 0.6,
      cellSize * 0.6
    );
  }

  for (const [index, player] of players.entries()) {
    const x = mapOffsetX + Number(player.x) * cellSize + cellSize / 2;
    const y = mapOffsetY + Number(player.y) * cellSize + cellSize / 2;
    const radius = Math.max(3, cellSize * 0.2);
    const baseColor = player.color || GAME_DOT_COLOR[index % GAME_DOT_COLOR.length];
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (player.username === currentUsername) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (selfPlayer) {
    const centerX = mapOffsetX + Number(selfPlayer.x) * cellSize + cellSize / 2;
    const centerY = mapOffsetY + Number(selfPlayer.y) * cellSize + cellSize / 2;
    const radiusPx = (visionRadius + 0.5) * cellSize;

    ctx.save();
    ctx.fillStyle = "rgba(3, 8, 15, 0.9)";
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.restore();

    ctx.strokeStyle = "rgba(146, 209, 255, 0.62)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (!mapRows.length) {
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "18px 'Exo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("等待地牢地图同步...", width / 2, height / 2);
  }

  const info = connectionStatus === CONNECTION_STATUS.CONNECTED
    ? `WASD / Arrow Keys TO MOVE (Vision ${visionRadius})`
    : "WAITING FOR SERVER";
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = "16px 'Exo 2', sans-serif";
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

function keyToAction(key) {
  const lookup = {
    w: "moveUp",
    s: "moveDown",
    a: "moveLeft",
    d: "moveRight",
    arrowup: "moveUp",
    arrowdown: "moveDown",
    arrowleft: "moveLeft",
    arrowright: "moveRight"
  };
  if (!key) {
    return "";
  }
  const normalized = String(key).toLowerCase();
  return lookup[normalized] || "";
}

function clearScheduledReturn(runtime) {
  if (!runtime) {
    return;
  }
  runtime.willReturnToRoom = false;
  if (runtime.returnTimer) {
    clearTimeout(runtime.returnTimer);
    runtime.returnTimer = null;
  }
  if (runtime.hold?.timer) {
    clearTimeout(runtime.hold.timer);
    runtime.hold.timer = null;
  }
  if (runtime.hold) {
    runtime.hold.action = "";
  }
}

function handleGameOver(state, runtime) {
  const serverState = state.game.serverState;
  if (!serverState?.game_over) {
    clearScheduledReturn(runtime);
    return;
  }
  if (runtime.hold?.timer) {
    clearTimeout(runtime.hold.timer);
    runtime.hold.timer = null;
    runtime.hold.action = "";
  }
  if (runtime.willReturnToRoom) {
    return;
  }
  runtime.willReturnToRoom = true;

  const delay = Number(serverState.return_delay_ms) > 0 ? Number(serverState.return_delay_ms) : 2400;
  const roomId = Number(serverState.room_id) || 0;
  const roomUrl = typeof serverState.room_url === "string" && serverState.room_url
    ? serverState.room_url
    : "/";
  addNotice("system", `游戏结束，${Math.ceil(delay / 1000)} 秒后返回房间`);
  runtime.returnTimer = setTimeout(() => {
    if (roomId > 0) {
      sessionStorage.setItem("resumeRoomId", String(roomId));
    }
    window.location.href = roomUrl;
  }, delay);
}

function getCurrentUsername() {
  if (typeof window === "undefined") {
    return "";
  }
  return localStorage.getItem("currentUser") || "";
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
