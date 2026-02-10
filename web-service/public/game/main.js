import { setupUI } from "./ui.js";
import { GameWebSocketClient } from "./ws-client.js";

const wsClient = new GameWebSocketClient();
setupUI(wsClient);

window.addEventListener("beforeunload", () => {
  wsClient.disconnect(false);
});
