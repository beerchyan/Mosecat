import {
  CONNECTION_STATUS,
  addNotice,
  getState,
  setConnectionStatus,
  setGameState,
  setHint,
  setReconnectAttempts
} from "./state.js";

const MAX_RECONNECT_ATTEMPTS = 8;

export class GameWebSocketClient {
  constructor() {
    this.ws = null;
    this.sessionNickname = "";
    this.manualClose = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  connect(nickname) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.sessionNickname = nickname || "Guest";
    this.manualClose = false;
    this.openSocket();
  }

  reconnect() {
    this.disconnect(false);
    this.manualClose = false;
    this.openSocket();
  }

  disconnect(resetStateToDisconnected = true) {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (this.ws) {
      this.ws.close(1000, "manual-close");
      this.ws = null;
    }

    if (resetStateToDisconnected) {
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED, { lastError: "" });
    }
  }

  sendPlayerAction(action, payload = {}) {
    this.sendEvent("playerAction", {
      action,
      ...payload
    });
  }

  openSocket() {
    const wsUrl = getState().wsUrl;

    setConnectionStatus(CONNECTION_STATUS.CONNECTING, {
      lastError: ""
    });

    addNotice("system", `正在连接 ${wsUrl}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      setReconnectAttempts(0);
      setConnectionStatus(CONNECTION_STATUS.CONNECTED, {
        lastError: ""
      });

      addNotice("system", "WebSocket 已连接");
      this.sendEvent("joinGame", {
        nickname: this.sessionNickname
      });
    });

    this.ws.addEventListener("message", (event) => {
      this.handleServerMessage(event.data);
    });

    this.ws.addEventListener("close", (event) => {
      this.ws = null;
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED, {});
      addNotice("system", `连接关闭(code=${event.code})`);

      if (this.manualClose) {
        return;
      }

      if (!getState().connection.autoReconnect) {
        return;
      }

      this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      addNotice("error", "WebSocket 连接出现错误");
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      addNotice("error", "重连次数已达上限，请手动重连");
      return;
    }

    this.reconnectAttempts += 1;
    setReconnectAttempts(this.reconnectAttempts);

    const waitMs = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10000);
    addNotice("system", `${waitMs}ms 后进行第 ${this.reconnectAttempts} 次重连`);

    this.reconnectTimer = setTimeout(() => {
      this.openSocket();
    }, waitMs);
  }

  sendEvent(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      addNotice("error", "连接未建立，发送失败");
      return;
    }

    this.ws.send(JSON.stringify({ type, payload }));
  }

  handleServerMessage(rawText) {
    let data;

    try {
      data = JSON.parse(rawText);
    } catch (_) {
      addNotice("error", "收到非 JSON 消息");
      return;
    }

    if (!data || typeof data !== "object") {
      addNotice("error", "收到无效消息对象");
      return;
    }

    const type = data.type;
    const payload = data.payload || {};

    if (type === "gameStateUpdate") {
      setGameState(payload);
      return;
    }

    if (type === "error") {
      const message = payload.message || "服务端返回错误";
      setHint(message);
      setConnectionStatus(getState().connection.status, { lastError: message });
      addNotice("error", message);
      return;
    }

    if (type === "notice") {
      const message = payload.message || "服务端通知";
      setHint(message);
      addNotice("notice", message);
      return;
    }

    addNotice("notice", `收到未处理事件: ${type || "unknown"}`);
  }
}
