# Mosecat

Mosecat 是一个房间聊天系统，包含 Web API、Socket.IO 服务和网关代理。

最后更新：2026-02-10（按仓库当前代码）

## 架构

- `web-service`（默认 `19924`）
  - 前端页面（`public/index.html`）
  - 认证、房间、消息相关 HTTP API
- `ws-service`（默认 `19925`）
  - Socket.IO 实时事件
  - 管理监控页面与统计接口
- `gateway`（默认 `19923`）
  - 反向代理入口
- `shared`
  - SQLite 初始化逻辑（`shared/db-init.js`）

## API

### 认证

- `POST /api/auth/register`
- `POST /api/auth/login`

### 房间

- `POST /api/rooms/create`（需 JWT）
- `POST /api/rooms/join`（需 JWT）
- `GET /api/rooms/list`（需 JWT）
- `POST /api/rooms/:roomId/leave`（需 JWT）
- `GET /api/rooms/:roomId/history`（需 JWT）

### 消息

- `POST /api/messages/send`（需 JWT）

## WebSocket 事件

客户端发送：

- `room:join`
- `room:leave`
- `message:send`

服务端推送：

- `room:event`
- `room:message`
- `error`

## 管理监控

- 页面：`http://localhost:19925/admin/monitor?key=admin-key-2025`
- 数据：`http://localhost:19925/admin/stats?key=admin-key-2025`
- 健康检查：`http://localhost:19925/health`

## 快速启动

仓库根目录没有统一 `package.json`，请分别安装和启动。

```powershell
# 安装依赖
cd web-service; npm install
cd ..\ws-service; npm install
cd ..\gateway; npm install

# 启动服务（建议顺序）
cd ..\ws-service; npm start
cd ..\web-service; npm start
cd ..\gateway; npm start
```

访问：

- Web 页面：`http://localhost:19923/`（或 `http://localhost:19924/`）

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

## 数据库

SQLite 文件：`data/mosecat.db`

表结构：

- `users`
- `rooms`
- `room_members`
- `messages`
- `events`

## 当前实现限制

- 前端当前发消息走 `POST /api/messages/send`（HTTP 落库），不会直接触发 `ws-service` 的 `message:send` 广播链路。
- 通过 `19923` 访问 `/admin/monitor` 会被网关转发到 `web-service`，监控页面请直连 `19925`。
