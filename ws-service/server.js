const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { initDB } = require('../shared/db-init');

const app = express();
const port = process.env.WS_PORT || 19925;
const JWT_SECRET = process.env.JWT_SECRET || 'mosecat-secret-key-2025';
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// 初始化数据库
let db;
const userConnections = new Map(); // 记录用户连接
const roomMembers = new Map(); // 记录在线房间成员

initDB(sqlite3).then((database) => {
  db = database;
  console.log('Database initialized');
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

// 中间件 - JWT验证
io.use((socket, next) => {
  const token = socket.handshake.query.token;
  const username = socket.handshake.query.username;

  if (!token || !username) {
    return next(new Error('Invalid credentials'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.id;
    socket.username = decoded.username;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
});

// WebSocket事件处理
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.username} (${socket.id})`);
  userConnections.set(socket.userId, socket.id);
  const reply = (callback, payload) => {
    if (typeof callback === 'function') {
      callback(payload);
    }
  };
  const parseRoomId = (value) => Number.parseInt(value, 10);
  const roomKeyOf = (roomId) => String(roomId);
  const isJoinedRoom = (roomId, callback) => {
    db.get(
      'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?',
      [roomId, socket.userId],
      (err, member) => {
        if (err) {
          callback(err, false);
          return;
        }

        callback(null, !!member);
      }
    );
  };
  const getRoomMemberSnapshot = (roomId, callback) => {
    db.all(
      `SELECT 
        rm.user_id,
        u.username,
        rm.joined_at
      FROM room_members rm
      INNER JOIN users u ON u.id = rm.user_id
      WHERE rm.room_id = ?
      ORDER BY rm.joined_at ASC`,
      [roomId],
      (err, members) => {
        if (err) {
          callback(err);
          return;
        }

        const onlineMemberSet = roomMembers.get(roomKeyOf(roomId)) || new Set();
        const memberList = (members || []).map((member) => ({
          user_id: member.user_id,
          username: member.username,
          joined_at: member.joined_at,
          online: onlineMemberSet.has(member.user_id)
        }));

        callback(null, {
          room_id: roomId,
          member_count: memberList.length,
          online_count: memberList.filter((member) => member.online).length,
          members: memberList
        });
      }
    );
  };
  const recordRoomEvent = (roomId, eventType) => {
    db.run(
      'INSERT INTO events (room_id, type, user_id, content) VALUES (?, ?, ?, ?)',
      [roomId, eventType, socket.userId, null],
      (err) => {
        if (!err) {
          io.to(`room:${roomId}`).emit('room:event', {
            room_id: roomId,
            type: eventType,
            username: socket.username,
            created_at: new Date().toISOString()
          });
        }
      }
    );
  };

  // 用户加入房间
  socket.on('room:join', async (data) => {
    const roomId = parseRoomId(data && data.room_id);

    if (!Number.isInteger(roomId) || roomId <= 0) {
      socket.emit('error', { message: '无效的房间ID' });
      return;
    }

    try {
      // 验证用户是否在房间中
      isJoinedRoom(roomId, (err, hasAccess) => {
          if (err || !hasAccess) {
            socket.emit('error', { message: '无权限加入此房间' });
            return;
          }

          socket.join(`room:${roomId}`);

          // 初始化房间成员记录
          const roomKey = roomKeyOf(roomId);
          if (!roomMembers.has(roomKey)) {
            roomMembers.set(roomKey, new Set());
          }
          roomMembers.get(roomKey).add(socket.userId);

          recordRoomEvent(roomId, 'join');

          console.log(`${socket.username} joined room ${roomId}`);
        }
      );
    } catch (error) {
      console.error('Error joining room:', error);
    }
  });

  // 用户离开房间
  socket.on('room:leave', (data) => {
    const roomId = parseRoomId(data && data.room_id);

    if (!Number.isInteger(roomId) || roomId <= 0) {
      return;
    }

    socket.leave(`room:${roomId}`);

    const roomKey = roomKeyOf(roomId);
    if (roomMembers.has(roomKey)) {
      const members = roomMembers.get(roomKey);
      members.delete(socket.userId);
      if (members.size === 0) {
        roomMembers.delete(roomKey);
      }
    }

    recordRoomEvent(roomId, 'leave');
  });

  // 拉取当前房间成员快照（WebSocket）
  socket.on('room:members:get', (data, callback) => {
    const roomId = parseRoomId(data && data.room_id);

    if (!Number.isInteger(roomId) || roomId <= 0) {
      reply(callback, { ok: false, message: '无效的房间ID' });
      return;
    }

    isJoinedRoom(roomId, (err, hasAccess) => {
      if (err) {
        reply(callback, { ok: false, message: '数据库错误' });
        return;
      }

      if (!hasAccess) {
        reply(callback, { ok: false, message: '无权限访问' });
        return;
      }

      getRoomMemberSnapshot(roomId, (snapshotErr, snapshot) => {
        if (snapshotErr) {
          reply(callback, { ok: false, message: '数据库错误' });
          return;
        }

        reply(callback, { ok: true, ...snapshot });
      });
    });
  });

  // 拉取房间历史（WebSocket）
  socket.on('history:get', (data, callback) => {
    const roomId = parseRoomId(data && data.room_id);
    const requestedLimit = Number.parseInt(data && data.limit, 10);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 10;

    if (!Number.isInteger(roomId) || roomId <= 0) {
      reply(callback, { ok: false, message: '无效的房间ID' });
      return;
    }

    isJoinedRoom(roomId, (err, hasAccess) => {
        if (err) {
          reply(callback, { ok: false, message: '数据库错误' });
          return;
        }

        if (!hasAccess) {
          reply(callback, { ok: false, message: '无权限访问' });
          return;
        }

        db.all(
          `SELECT type, id, room_id, user_id, username, content, created_at
          FROM (
            SELECT *
            FROM (
              SELECT 
                'message' AS type, 
                m.id, 
                m.room_id, 
                m.user_id, 
                u.username, 
                m.content, 
                m.created_at,
                m.id AS sort_id
              FROM messages m 
              JOIN users u ON m.user_id = u.id 
              WHERE m.room_id = ? 
              UNION ALL 
              SELECT 
                e.type AS type, 
                e.id, 
                e.room_id, 
                e.user_id, 
                (SELECT username FROM users WHERE id = e.user_id) AS username, 
                e.content, 
                e.created_at,
                e.id AS sort_id
              FROM events e 
              WHERE e.room_id = ? 
            )
            ORDER BY datetime(created_at) DESC, sort_id DESC
            LIMIT ?
          )
          ORDER BY datetime(created_at) ASC, sort_id ASC`,
          [roomId, roomId, limit],
          (historyErr, history) => {
            if (historyErr) {
              reply(callback, { ok: false, message: '数据库错误' });
              return;
            }

            reply(callback, { ok: true, history: history || [] });
          }
        );
      }
    );
  });

  // 接收消息（WebSocket）
  socket.on('message:send', (data, callback) => {
    const roomId = parseRoomId(data && data.room_id);
    const content = typeof data?.content === 'string' ? data.content.trim() : '';

    if (!Number.isInteger(roomId) || roomId <= 0 || !content || content.length > 1000) {
      const error = { message: '无效的消息数据' };
      socket.emit('error', error);
      reply(callback, { ok: false, message: error.message });
      return;
    }

    // 验证用户权限
    isJoinedRoom(roomId, (err, hasAccess) => {
        if (err || !hasAccess) {
          const error = { message: '无权限在此房间发送消息' };
          socket.emit('error', error);
          reply(callback, { ok: false, message: error.message });
          return;
        }

        // 保存消息到数据库
        db.run(
          'INSERT INTO messages (room_id, user_id, content) VALUES (?, ?, ?)',
          [roomId, socket.userId, content],
          (saveErr) => {
            if (saveErr) {
              const error = { message: '消息发送失败' };
              socket.emit('error', error);
              reply(callback, { ok: false, message: error.message });
              return;
            }

            const payload = {
              room_id: roomId,
              user_id: socket.userId,
              username: socket.username,
              content,
              created_at: new Date().toISOString()
            };

            // 广播消息
            io.to(`room:${roomId}`).emit('room:message', payload);
            reply(callback, { ok: true, message: payload });
          }
        );
      }
    );
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.username} (${socket.id})`);
    userConnections.delete(socket.userId);

    // 从所有房间移除用户
    for (const [roomKey, members] of roomMembers.entries()) {
      if (members.has(socket.userId)) {
        members.delete(socket.userId);
        if (members.size === 0) {
          roomMembers.delete(roomKey);
        }

        const roomId = Number.parseInt(roomKey, 10);
        if (!Number.isInteger(roomId) || roomId <= 0) {
          continue;
        }

        // 记录离开事件
        recordRoomEvent(roomId, 'leave');
      }
    }
  });
});

// 错误处理
io.on('error', (error) => {
  console.error('Socket.IO error:', error);
});

// 管理监控页面 - 分离的系统
app.get('/admin/monitor', (req, res) => {
  // 简单的API密钥验证
  const apiKey = req.query.key;
  const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-key-2025';

  if (apiKey !== ADMIN_KEY) {
    return res.status(403).json({ message: '无效的API密钥' });
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mosecat WebSocket 管理监控</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f5f5f5;
          padding: 20px;
        }
        
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        
        h1 {
          margin-bottom: 20px;
          color: #333;
        }
        
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .stat-card {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .stat-card h3 {
          color: #999;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        
        .stat-value {
          font-size: 32px;
          font-weight: bold;
          color: #4CAF50;
        }
        
        .section {
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          margin-bottom: 20px;
        }
        
        .section h2 {
          margin-bottom: 15px;
          color: #333;
          font-size: 16px;
          border-bottom: 2px solid #4CAF50;
          padding-bottom: 10px;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        
        th {
          background: #f5f5f5;
          padding: 10px;
          text-align: left;
          font-weight: 600;
          color: #666;
        }
        
        td {
          padding: 10px;
          border-bottom: 1px solid #eee;
        }
        
        tr:hover {
          background: #fafafa;
        }
        
        .status {
          display: inline-block;
          width: 8px;
          height: 8px;
          background: #4CAF50;
          border-radius: 50%;
          margin-right: 5px;
        }
        
        .refresh-info {
          color: #999;
          font-size: 12px;
          margin-top: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🐱 Mosecat WebSocket 管理监控</h1>
        
        <div class="stats">
          <div class="stat-card">
            <h3>在线用户</h3>
            <div class="stat-value" id="onlineUsers">0</div>
          </div>
          <div class="stat-card">
            <h3>活跃房间</h3>
            <div class="stat-value" id="activeRooms">0</div>
          </div>
          <div class="stat-card">
            <h3>总连接数</h3>
            <div class="stat-value" id="totalConnections">0</div>
          </div>
          <div class="stat-card">
            <h3>服务状态</h3>
            <div class="stat-value" style="font-size: 16px;"><span class="status"></span><span id="serverStatus">运行中</span></div>
          </div>
        </div>
        
        <div class="section">
          <h2>在线用户</h2>
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>Socket ID</th>
                <th>所在房间</th>
                <th>连接时间</th>
              </tr>
            </thead>
            <tbody id="usersTable">
              <tr><td colspan="4" style="text-align: center; color: #999;">暂无在线用户</td></tr>
            </tbody>
          </table>
          <div class="refresh-info">自动刷新中...</div>
        </div>
        
        <div class="section">
          <h2>房间列表</h2>
          <table>
            <thead>
              <tr>
                <th>房间名</th>
                <th>创建者</th>
                <th>成员数</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody id="roomsTable">
              <tr><td colspan="4" style="text-align: center; color: #999;">暂无房间</td></tr>
            </tbody>
          </table>
          <div class="refresh-info">自动刷新中...</div>
        </div>
      </div>
      
      <script>
        const ADMIN_KEY = '${ADMIN_KEY}';
        
        async function updateStats() {
          try {
            const response = await fetch(\`/admin/stats?key=\${ADMIN_KEY}\`);
            const data = await response.json();
            
            if (!data.error) {
              // 更新统计数据
              document.getElementById('onlineUsers').textContent = data.onlineUsers;
              document.getElementById('activeRooms').textContent = data.activeRooms;
              document.getElementById('totalConnections').textContent = data.totalConnections;
              
              // 更新用户表
              const usersTable = document.getElementById('usersTable');
              if (data.users && data.users.length > 0) {
                usersTable.innerHTML = data.users.map(user => \`
                  <tr>
                    <td>\${user.username}</td>
                    <td style="font-family: monospace; font-size: 11px;">\${user.socketId.substring(0, 8)}...</td>
                    <td>\${user.rooms.join(', ') || '无'}</td>
                    <td>\${new Date(user.connectedAt).toLocaleString('zh-CN')}</td>
                  </tr>
                \`).join('');
              } else {
                usersTable.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999;">暂无在线用户</td></tr>';
              }
              
              // 更新房间表
              const roomsTable = document.getElementById('roomsTable');
              if (data.rooms && data.rooms.length > 0) {
                roomsTable.innerHTML = data.rooms.map(room => \`
                  <tr>
                    <td>\${room.name}</td>
                    <td>\${room.creator}</td>
                    <td>\${room.memberCount}</td>
                    <td>\${new Date(room.createdAt).toLocaleString('zh-CN')}</td>
                  </tr>
                \`).join('');
              } else {
                roomsTable.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999;">暂无房间</td></tr>';
              }
            }
          } catch (error) {
            console.error('Failed to update stats:', error);
          }
        }
        
        // 初始更新和定时刷新
        updateStats();
        setInterval(updateStats, 3000); // 每3秒刷新一次
      </script>
    </body>
    </html>
  `);
});

// 管理统计API - 分离的认证
app.get('/admin/stats', (req, res) => {
  const apiKey = req.query.key;
  const ADMIN_KEY = process.env.ADMIN_KEY || 'admin-key-2025';

  if (apiKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  try {
    // 获取在线用户数
    const sockets = io.sockets.sockets;
    const users = [];
    const userRooms = new Map();

    sockets.forEach((socket) => {
      const rooms = Array.from(socket.rooms).filter(r => r.startsWith('room:')).map(r => r.substring(5));
      users.push({
        username: socket.username,
        socketId: socket.id,
        rooms: rooms,
        connectedAt: new Date()
      });

      if (!userRooms.has(socket.username)) {
        userRooms.set(socket.username, rooms);
      }
    });

    // 获取房间数据
    db.all('SELECT rooms.*, users.username as creator FROM rooms LEFT JOIN users ON rooms.creator_id = users.id', (err, rooms) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const roomData = (rooms || []).map(room => ({
        name: room.name,
        creator: room.creator || 'Unknown',
        memberCount: roomMembers.has(String(room.id)) ? roomMembers.get(String(room.id)).size : 0,
        createdAt: room.created_at
      }));

      res.json({
        onlineUsers: sockets.size,
        activeRooms: roomMembers.size,
        totalConnections: sockets.size,
        users: users,
        rooms: roomData,
        timestamp: new Date().toISOString()
      });
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

server.listen(port, () => {
  console.log(`WebSocket Service listening on port ${port}`);
  console.log(`Admin Monitor: http://localhost:${port}/admin/monitor?key=admin-key-2025`);
});
