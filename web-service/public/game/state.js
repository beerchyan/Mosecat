export const CONNECTION_STATUS = Object.freeze({
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected"
});

const INITIAL_STATE = Object.freeze({
  screen: "home",
  wsUrl: resolveGameSocketEndpoint(),
  player: {
    nickname: ""
  },
  connection: {
    status: CONNECTION_STATUS.DISCONNECTED,
    reconnectAttempts: 0,
    autoReconnect: true,
    lastError: ""
  },
  game: {
    serverState: null,
    hint: "进入游戏后，使用 WASD 或方向键到达终点。"
  },
  notices: []
});

let state = cloneState(INITIAL_STATE);
const subscribers = new Set();

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveGameSocketEndpoint() {
  if (typeof window === "undefined") {
    return "";
  }

  if (typeof window.__MOSECAT_WS_URL__ === "string" && window.__MOSECAT_WS_URL__) {
    return window.__MOSECAT_WS_URL__;
  }

  const { protocol, hostname, port } = window.location;
  if (port === "19924") {
    return `${protocol}//${hostname}:19925`;
  }

  return "";
}

function publish() {
  for (const callback of subscribers) {
    callback(state);
  }
}

export function getState() {
  return state;
}

export function subscribe(callback) {
  subscribers.add(callback);
  callback(state);
  return () => subscribers.delete(callback);
}

export function updateState(updater) {
  const nextState = updater(state);
  if (!nextState || nextState === state) {
    return;
  }
  state = nextState;
  publish();
}

export function setScreen(screen) {
  updateState((prev) => ({
    ...prev,
    screen
  }));
}

export function setNickname(nickname) {
  updateState((prev) => ({
    ...prev,
    player: {
      ...prev.player,
      nickname
    }
  }));
}

export function setAutoReconnect(autoReconnect) {
  updateState((prev) => ({
    ...prev,
    connection: {
      ...prev.connection,
      autoReconnect
    }
  }));
}

export function setConnectionStatus(status, extra = {}) {
  updateState((prev) => ({
    ...prev,
    connection: {
      ...prev.connection,
      status,
      ...extra
    }
  }));
}

export function setReconnectAttempts(reconnectAttempts) {
  updateState((prev) => ({
    ...prev,
    connection: {
      ...prev.connection,
      reconnectAttempts
    }
  }));
}

export function setGameState(serverState) {
  const hint = pickHint(serverState) || "收到 gameStateUpdate。";
  updateState((prev) => ({
    ...prev,
    game: {
      ...prev.game,
      serverState,
      hint
    }
  }));
}

export function setHint(hint) {
  updateState((prev) => ({
    ...prev,
    game: {
      ...prev.game,
      hint
    }
  }));
}

export function resetGameView() {
  updateState((prev) => ({
    ...prev,
    game: {
      ...prev.game,
      serverState: null,
      hint: "已返回首页。"
    }
  }));
}

export function addNotice(level, text) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    text,
    createdAt: new Date().toISOString()
  };

  updateState((prev) => ({
    ...prev,
    notices: [item, ...prev.notices].slice(0, 40)
  }));
}

function pickHint(serverState) {
  if (!serverState || typeof serverState !== "object") {
    return "";
  }
  return serverState.hint || serverState.notice || serverState.message || "";
}
