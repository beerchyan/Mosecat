const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = process.env.GATEWAY_PORT || 19923;
const webTarget = process.env.WEB_SERVICE_URL || 'http://localhost:19924';
const wsTarget = process.env.WS_SERVICE_URL || 'http://localhost:19925';

// Socket.IO must be registered before "/" fallback proxy.
// Use context matching to preserve the original /socket.io path.
app.use(createProxyMiddleware('/socket.io', {
  target: wsTarget,
  changeOrigin: true,
  ws: true
}));

app.use('/', createProxyMiddleware({
  target: webTarget,
  changeOrigin: true
}));

app.listen(port, () => console.log(`Gateway listening on ${port}`));
