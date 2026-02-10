const express = require('express');
const path = require('path');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { initDB } = require('../shared/db-init');

const app = express();
const port = process.env.WEB_PORT || 19924;
const JWT_SECRET = process.env.JWT_SECRET || 'mosecat-secret-key-2025';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 初始化数据库
let db;
initDB(sqlite3).then((database) => {
  db = database;
  console.log('Database initialized');
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});

// JWT认证中间件
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '未提供令牌' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: '无效的令牌' });
    }
    req.user = user;
    next();
  });
}

// 生成JWT令牌
function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '7d'
  });
}

// 健全性检查 - 输入验证
function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 20) return false;
  return /^[a-zA-Z0-9_-]+$/.test(username);
}

// 认证API
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;

  if (!validateUsername(username) || !password || password.length < 6) {
    return res.status(400).json({
      message: '用户名必须3-20个字符（只含字母、数字、下划线、连字符），密码至少6个字符'
    });
  }

  try {
    // 检查用户是否已存在
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
      if (err) {
        return res.status(500).json({ message: '数据库错误' });
      }

      if (row) {
        return res.status(400).json({ message: '用户名已被使用' });
      }

      // 密码加密
      const passwordHash = await bcryptjs.hash(password, 10);

      db.run(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)',
        [username, passwordHash],
        function(err) {
          if (err) {
            return res.status(500).json({ message: '注册失败' });
          }

          const user = { id: this.lastID, username };
          const token = generateToken(user);

          res.status(201).json({
            message: '注册成功',
            token,
            username
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: '请提供用户名和密码' });
  }

  try {
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: '数据库错误' });
      }

      if (!user) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }

      const passwordMatch = await bcryptjs.compare(password, user.password_hash);

      if (!passwordMatch) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }

      const token = generateToken(user);

      res.json({
        message: '登录成功',
        token,
        username: user.username
      });
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// 房间API
app.post('/api/rooms/create', authenticateToken, (req, res) => {
  const { name, description } = req.body;
  const userId = req.user.id;

  if (!name || name.length < 1 || name.length > 50) {
    return res.status(400).json({ message: '房间名称长度1-50个字符' });
  }

  db.run(
    'INSERT INTO rooms (name, creator_id, description) VALUES (?, ?, ?)',
    [name, userId, description || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ message: '房间名称已存在' });
        }
        return res.status(500).json({ message: '创建失败' });
      }

      const roomId = this.lastID;

      // 创建者自动加入房间
      db.run(
        'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
        [roomId, userId],
        (err) => {
          if (err) {
            return res.status(500).json({ message: '创建失败' });
          }

          res.status(201).json({
            message: '房间创建成功',
            room: { id: roomId, name, description }
          });
        }
      );
    }
  );
});

app.post('/api/rooms/join', authenticateToken, (req, res) => {
  const { name } = req.body;
  const userId = req.user.id;

  if (!name) {
    return res.status(400).json({ message: '请提供房间名称' });
  }

  db.get('SELECT id FROM rooms WHERE name = ?', [name], (err, room) => {
    if (err) {
      return res.status(500).json({ message: '数据库错误' });
    }

    if (!room) {
      return res.status(404).json({ message: '房间不存在' });
    }

    db.run(
      'INSERT INTO room_members (room_id, user_id) VALUES (?, ?)',
      [room.id, userId],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ message: '已加入该房间' });
          }
          return res.status(500).json({ message: '加入失败' });
        }

        res.json({ message: '加入成功' });
      }
    );
  });
});

app.get('/api/rooms/list', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT rooms.* FROM rooms 
     INNER JOIN room_members ON rooms.id = room_members.room_id 
     WHERE room_members.user_id = ? 
     ORDER BY rooms.created_at DESC`,
    [userId],
    (err, rooms) => {
      if (err) {
        return res.status(500).json({ message: '数据库错误' });
      }

      res.json({ rooms: rooms || [] });
    }
  );
});

app.get('/api/rooms/overview', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT 
      rooms.*, 
      (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = rooms.id) AS member_count,
      'created' AS status
    FROM rooms
    WHERE rooms.creator_id = ?
    ORDER BY rooms.created_at DESC`,
    [userId],
    (createdErr, createdRooms) => {
      if (createdErr) {
        return res.status(500).json({ message: '数据库错误' });
      }

      db.all(
        `SELECT 
          rooms.*, 
          (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = rooms.id) AS member_count,
          'joined' AS status
        FROM rooms
        INNER JOIN room_members ON rooms.id = room_members.room_id
        WHERE room_members.user_id = ? AND rooms.creator_id != ?
        ORDER BY rooms.created_at DESC`,
        [userId, userId],
        (joinedErr, joinedRooms) => {
          if (joinedErr) {
            return res.status(500).json({ message: '数据库错误' });
          }

          res.json({
            createdRooms: createdRooms || [],
            joinedRooms: joinedRooms || []
          });
        }
      );
    }
  );
});

app.post('/api/rooms/:roomId/leave', authenticateToken, (req, res) => {
  const roomId = parseInt(req.params.roomId);
  const userId = req.user.id;

  db.run(
    'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
    [roomId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ message: '操作失败' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ message: '你不在这个房间' });
      }

      res.json({ message: '已离开房间' });
    }
  );
});

app.get('/api/rooms/:roomId/history', authenticateToken, (req, res) => {
  const roomId = parseInt(req.params.roomId);
  const userId = req.user.id;

  // 检查用户是否在房间中
  db.get(
    'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?',
    [roomId, userId],
    (err, member) => {
      if (err) {
        return res.status(500).json({ message: '数据库错误' });
      }

      if (!member) {
        return res.status(403).json({ message: '无权限访问' });
      }

      // 获取消息和事件
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
          LIMIT 100
        )
        ORDER BY datetime(created_at) ASC, sort_id ASC`,
        [roomId, roomId],
        (err, history) => {
          if (err) {
            return res.status(500).json({ message: '数据库错误' });
          }

          res.json({ history: history || [] });
        }
      );
    }
  );
});

// 消息API
app.post('/api/messages/send', authenticateToken, (req, res) => {
  const { room_id, content } = req.body;
  const userId = req.user.id;

  if (!room_id || !content || content.length === 0 || content.length > 1000) {
    return res.status(400).json({ message: '消息长度1-1000个字符' });
  }

  // 检查用户是否在房间中
  db.get(
    'SELECT id FROM room_members WHERE room_id = ? AND user_id = ?',
    [room_id, userId],
    (err, member) => {
      if (err) {
        return res.status(500).json({ message: '数据库错误' });
      }

      if (!member) {
        return res.status(403).json({ message: '你不在这个房间' });
      }

      db.run(
        'INSERT INTO messages (room_id, user_id, content) VALUES (?, ?, ?)',
        [room_id, userId, content],
        function(err) {
          if (err) {
            return res.status(500).json({ message: '发送失败' });
          }

          res.status(201).json({
            message: '消息已发送',
            messageId: this.lastID
          });
        }
      );
    }
  );
});

app.listen(port, () => {
  console.log(`Web Service listening on port ${port}`);
});

module.exports = app;
