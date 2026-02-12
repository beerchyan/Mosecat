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
    this.socket = null;
    this.sessionNickname = "";
    this.sessionRoomId = null;
    this.sessionSeed = null;
    this.manualClose = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  connect(nickname) {
    if (this.socket && this.socket.connected) {
      return;
    }

    this.sessionNickname = nickname || "Guest";
    this.sessionRoomId = this.resolveRoomId();
    this.sessionSeed = this.resolveSeed();
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

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
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
    if (typeof globalThis.io !== "function") {
      const message = "Socket.IO 客户端未加载";
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED, { lastError: message });
      setHint(message);
      addNotice("error", message);
      return;
    }

    const wsUrl = getState().wsUrl;
    const auth = this.resolveAuth();
    if (!auth.token || !auth.username) {
      const message = "缺少登录信息，请先回到聊天室登录";
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED, { lastError: message });
      setHint(message);
      addNotice("error", message);
      return;
    }

    setConnectionStatus(CONNECTION_STATUS.CONNECTING, {
      lastError: ""
    });

    addNotice("system", `正在连接 Socket.IO ${wsUrl || "(same-origin /socket.io)"}`);

    const options = {
      autoConnect: true,
      reconnection: false,
      transports: ["websocket", "polling"],
      query: {
        token: auth.token,
        username: auth.username,
        roomId: this.sessionRoomId || ""
      }
    };

    this.socket = wsUrl ? globalThis.io(wsUrl, options) : globalThis.io(options);

    this.socket.on("connect", () => {
      this.reconnectAttempts = 0;
      setReconnectAttempts(0);
      setConnectionStatus(CONNECTION_STATUS.CONNECTED, {
        lastError: ""
      });

      addNotice("system", "Socket.IO 已连接");
      this.sendEvent("joinGame", {
        nickname: this.sessionNickname,
        room_id: this.sessionRoomId,
        seed: this.sessionSeed
      });
    });

    this.socket.on("gameStateUpdate", (payload) => {
      setGameState(payload || {});
    });

    this.socket.on("notice", (payload) => {
      const message = payload?.message || "服务端通知";
      setHint(message);
      addNotice("notice", message);
    });

    this.socket.on("error", (payload) => {
      this.handleServerError(payload);
    });

    this.socket.on("disconnect", (reason) => {
      this.socket = null;
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED, {});
      addNotice("system", `连接关闭(reason=${reason || "unknown"})`);

      if (this.manualClose) {
        return;
      }

      if (!getState().connection.autoReconnect) {
        return;
      }

      this.scheduleReconnect();
    });

    this.socket.on("connect_error", (error) => {
      const message = error?.message || "Socket.IO 连接出现错误";
      setHint(message);
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED, { lastError: message });
      addNotice("error", message);

      if (this.manualClose || !getState().connection.autoReconnect) {
        return;
      }

      this.scheduleReconnect();
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
    if (!this.socket || !this.socket.connected) {
      addNotice("error", "连接未建立，发送失败");
      return;
    }

    this.socket.emit(type, payload);
  }

  handleServerError(payload) {
    const message = payload?.message || "服务端返回错误";
    setHint(message);
    setConnectionStatus(getState().connection.status, { lastError: message });
    addNotice("error", message);
  }

  resolveAuth() {
    if (typeof window === "undefined") {
      return { token: "", username: "" };
    }
    return {
      token: localStorage.getItem("authToken") || "",
      username: localStorage.getItem("currentUser") || ""
    };
  }

  resolveRoomId() {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("roomId");
    const roomId = Number.parseInt(raw || "", 10);
    return Number.isInteger(roomId) && roomId > 0 ? roomId : null;
  }

  resolveSeed() {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("seed");
    const seed = Number.parseInt(raw || "", 10);
    return Number.isInteger(seed) ? seed : null;
  }
}
