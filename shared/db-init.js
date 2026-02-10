const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'mosecat.db');

// 确保数据目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库
function initDB(sqlite3) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);

    db.serialize(() => {
      // 用户表
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
      });

      // 房间表
      db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          creator_id INTEGER NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (creator_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) reject(err);
      });

      // 房间成员表
      db.run(`
        CREATE TABLE IF NOT EXISTS room_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE(room_id, user_id)
        )
      `, (err) => {
        if (err) reject(err);
      });

      // 消息表
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) reject(err);
      });

      // 系统事件表（用于显示用户上线、进入房间等事件）
      db.run(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER,
          type TEXT NOT NULL,
          user_id INTEGER,
          content TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  });
}

module.exports = {
  initDB,
  dbPath
};
