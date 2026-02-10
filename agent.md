# Mosecat - Agent Configuration (按当前实现)

最后更新：2026-02-10

## 项目定位

当前仓库实现的是一个实时聊天/房间系统（不是游戏网关模板），由三个 Node.js 服务组成：

- `web-service`：HTTP API + 前端页面
- `ws-service`：Socket.IO 实时通信 + 管理监控
- `gateway`：反向代理入口

共享模块为 `shared/db-init.js`（SQLite 初始化）。

## 目录结构（实际）

```text
mosecat/
├── agent.md
├── README.md
├── data/
│   └── mosecat.db
├── shared/
│   ├── constants.js
│   └── db-init.js
├── web-service/
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── server.js
├── ws-service/
│   ├── package.json
│   └── server.js
└── gateway/
    ├── package.json
    └── server.js
```

## 服务与端口

- Web Service：`19924`（`WEB_PORT`）
- WebSocket Service：`19925`（`WS_PORT`）
- Gateway：`19923`（`GATEWAY_PORT`）

默认地址：

- Web：`http://localhost:19924`
- WS 服务健康检查：`http://localhost:19925/health`
- Gateway：`http://localhost:19923`

## Web Service（`web-service/server.js`）

### 主要能力

- 静态页面：`/`（`public/index.html`）
- 用户认证：JWT + `bcryptjs`
- 房间管理：创建、加入、列出、离开
- 历史记录：消息 + 事件（最多 100 条，按时间升序）
- 消息写入：写入 `messages` 表

### HTTP API（当前实现）

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/rooms/create`（需 JWT）
- `POST /api/rooms/join`（需 JWT）
- `GET /api/rooms/list`（需 JWT）
- `POST /api/rooms/:roomId/leave`（需 JWT）
- `GET /api/rooms/:roomId/history`（需 JWT）
- `POST /api/messages/send`（需 JWT）

### 鉴权说明

- Header：`Authorization: Bearer <token>`
- JWT 默认密钥：`mosecat-secret-key-2025`（建议通过环境变量覆盖）

## WebSocket Service（`ws-service/server.js`）

### 连接与鉴权

- 采用 Socket.IO（`transports: ['websocket', 'polling']`）
- 握手参数必须包含：
  - `token`（JWT）
  - `username`
- 服务端会校验 token，并把 `decoded.id/decoded.username` 写入 socket 上下文

### 事件（当前实现）

客户端发送：

- `room:join` `{ room_id }`
- `room:leave` `{ room_id }`
- `message:send` `{ room_id, content }`

服务端推送：

- `room:event`（`join`/`leave`）
- `room:message`
- `error`

### 管理接口

- `GET /health`
- `GET /admin/monitor?key=<ADMIN_KEY>`（监控页面）
- `GET /admin/stats?key=<ADMIN_KEY>`（监控数据 JSON）

默认 `ADMIN_KEY`：`admin-key-2025`

## Gateway（`gateway/server.js`）

### 当前代码中的代理规则

- `app.use('/socket.io') -> WS_SERVICE_URL`（默认 `http://localhost:19925`，开启 `ws: true`）
- `app.use('/') -> WEB_SERVICE_URL`（默认 `http://localhost:19924`）

### 当前实现限制（按现有代码）

- 监控页 `/admin/monitor` 通过 `19923` 访问时，会落到 `web-service`，不是 `ws-service`。

结论：当前要访问监控页应直连 `ws-service`：

- `http://localhost:19925/admin/monitor?key=admin-key-2025`

## 数据库（`shared/db-init.js`）

SQLite 文件：`data/mosecat.db`

初始化表：

- `users`
- `rooms`
- `room_members`
- `messages`
- `events`

## 启动方式（当前仓库）

注意：仓库根目录没有统一 `package.json`，需要分别启动三个服务。

```powershell
# 安装依赖
cd web-service; npm install
cd ..\ws-service; npm install
cd ..\gateway; npm install

# 启动服务
cd ..\ws-service; npm start
cd ..\web-service; npm start
cd ..\gateway; npm start
```

## 环境变量

```env
WEB_PORT=19924
WS_PORT=19925
GATEWAY_PORT=19923

WEB_SERVICE_URL=http://localhost:19924
WS_SERVICE_URL=http://localhost:19925

JWT_SECRET=your_jwt_secret
ADMIN_KEY=your_admin_key
```

## 已知实现差异（文档即事实）

- `web-service` 的 `POST /api/messages/send` 只写库，不会主动触发 `ws-service` 广播。
- 前端页面当前发送消息走 HTTP，而不是 `socket.emit('message:send')`。
- `room:leave` 的 Socket 事件需要前端主动发；仅调用 HTTP 离开接口不会通知 WS 房间。
- 通过 Gateway 的 `19923` 访问 `/admin/monitor` 仍会落到 `web-service`；监控页请直连 `19925`。
