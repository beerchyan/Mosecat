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
const roomReadyStates = new Map(); // 记录房间成员准备状态
const gameRoomStates = new Map(); // 记录游戏房间状态

const GAME_MAP_WIDTH = 31;
const GAME_MAP_HEIGHT = 21;
const PLAYER_SPEED_UNITS_PER_SEC = 0.5;
const PLAYER_MOVE_INTERVAL_MS = Math.round(1000 / PLAYER_SPEED_UNITS_PER_SEC);
const GAME_COLORS = ['#ff9c4d', '#5ad2ff', '#ffd95e', '#8ef0a8', '#ee8cff', '#f77a7a'];

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
  const getRoomInfo = (roomId, callback) => {
    db.get(
      'SELECT id, creator_id, name FROM rooms WHERE id = ?',
      [roomId],
      (err, room) => {
        if (err) {
          callback(err);
          return;
        }
        callback(null, room || null);
      }
    );
  };
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
  const setRoomReadyState = (roomId, userId, ready) => {
    const roomKey = roomKeyOf(roomId);
    if (!roomReadyStates.has(roomKey)) {
      roomReadyStates.set(roomKey, new Map());
    }
    roomReadyStates.get(roomKey).set(userId, !!ready);
  };
  const clearRoomReadyState = (roomId, userId) => {
    const roomKey = roomKeyOf(roomId);
    if (!roomReadyStates.has(roomKey)) {
      return;
    }
    const readyMap = roomReadyStates.get(roomKey);
    readyMap.delete(userId);
    if (readyMap.size === 0) {
      roomReadyStates.delete(roomKey);
    }
  };
  const buildRoomLobbySnapshot = (roomId, callback) => {
    getRoomMemberSnapshot(roomId, (memberErr, memberSnapshot) => {
      if (memberErr) {
        callback(memberErr);
        return;
      }

      getRoomInfo(roomId, (roomErr, roomInfo) => {
        if (roomErr) {
          callback(roomErr);
          return;
        }

        if (!roomInfo) {
          callback(new Error('房间不存在'));
          return;
        }

        const readyMap = roomReadyStates.get(roomKeyOf(roomId)) || new Map();
        const members = (memberSnapshot.members || []).map((member) => ({
          ...member,
          ready: member.online && !!readyMap.get(member.user_id)
        }));
        const onlineMembers = members.filter((member) => member.online);
        const onlineReadyCount = onlineMembers.filter((member) => member.ready).length;

        callback(null, {
          ...memberSnapshot,
          members,
          owner_id: Number(roomInfo.creator_id),
          all_online_ready: onlineMembers.length > 0 && onlineReadyCount === onlineMembers.length,
          online_ready_count: onlineReadyCount
        });
      });
    });
  };
  const emitRoomLobbyUpdate = (roomId) => {
    buildRoomLobbySnapshot(roomId, (snapshotErr, snapshot) => {
      if (snapshotErr) {
        return;
      }
      io.to(`room:${roomId}`).emit('room:lobby:update', snapshot);
    });
  };
  const recordRoomEvent = (roomId, eventType, options = {}) => {
    const eventContent = typeof options.content === 'string' ? options.content : null;
    const eventUsername = typeof options.username === 'string' ? options.username : socket.username;
    db.run(
      'INSERT INTO events (room_id, type, user_id, content) VALUES (?, ?, ?, ?)',
      [roomId, eventType, socket.userId, eventContent],
      (err) => {
        if (!err) {
          io.to(`room:${roomId}`).emit('room:event', {
            room_id: roomId,
            type: eventType,
            username: eventUsername,
            content: eventContent,
            created_at: new Date().toISOString()
          });
        }
      }
    );
  };
  const parseGameRoomId = (value) => {
    const roomId = parseRoomId(value);
    return Number.isInteger(roomId) && roomId > 0 ? roomId : null;
  };
  const resolveGameRoomId = (payload = {}) => {
    return parseGameRoomId(
      payload.room_id
      ?? payload.roomId
      ?? socket.handshake.query.roomId
      ?? socket.data.gameRoomId
    );
  };
  const gameRoomKeyOf = (roomId) => `game:${roomId}`;
  const toOddSize = (value, minValue = 9) => {
    const num = Number(value);
    const size = Number.isInteger(num) && num >= minValue ? num : minValue;
    return size % 2 === 0 ? size - 1 : size;
  };
  const createSeededRandom = (seedInput) => {
    let seed = Number(seedInput);
    if (!Number.isFinite(seed)) {
      seed = Number.parseInt(String(seedInput || ''), 10);
    }
    if (!Number.isFinite(seed)) {
      seed = Date.now();
    }
    let state = (seed >>> 0) || 1;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 4294967296);
    };
  };
  const shuffleByRandom = (list, random) => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  };
  const generateDungeonFromSeed = (seed, width = GAME_MAP_WIDTH, height = GAME_MAP_HEIGHT) => {
    const mapWidth = toOddSize(width);
    const mapHeight = toOddSize(height);
    const random = createSeededRandom(seed);
    const grid = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(1));
    const rooms = [];
    const roomTarget = 8 + Math.floor(random() * 5);
    const roomAttempts = 260;
    const roomSizeOptions = [3, 4, 5];
    const overlaps = (a, b, margin = 1) => {
      const aLeft = a.x - margin;
      const aTop = a.y - margin;
      const aRight = a.x + a.w - 1 + margin;
      const aBottom = a.y + a.h - 1 + margin;
      const bLeft = b.x;
      const bTop = b.y;
      const bRight = b.x + b.w - 1;
      const bBottom = b.y + b.h - 1;
      return !(aRight < bLeft || bRight < aLeft || aBottom < bTop || bBottom < aTop);
    };
    const carveRoom = (room) => {
      for (let y = room.y; y < room.y + room.h; y += 1) {
        for (let x = room.x; x < room.x + room.w; x += 1) {
          grid[y][x] = 0;
        }
      }
    };
    const roomCenter = (room) => ({
      x: room.x + Math.floor(room.w / 2),
      y: room.y + Math.floor(room.h / 2)
    });
    const carveLine = (x1, y1, x2, y2) => {
      if (x1 === x2) {
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        for (let y = minY; y <= maxY; y += 1) {
          grid[y][x1] = 0;
        }
        return;
      }
      if (y1 === y2) {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        for (let x = minX; x <= maxX; x += 1) {
          grid[y1][x] = 0;
        }
      }
    };
    const carveCorridorBetweenRooms = (roomA, roomB) => {
      const centerA = roomCenter(roomA);
      const centerB = roomCenter(roomB);
      const sidePriority = (() => {
        const dx = centerB.x - centerA.x;
        const dy = centerB.y - centerA.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          return dx >= 0 ? ['right', 'left', 'bottom', 'top'] : ['left', 'right', 'top', 'bottom'];
        }
        return dy >= 0 ? ['bottom', 'top', 'right', 'left'] : ['top', 'bottom', 'left', 'right'];
      })();
      const getBoundaryPoints = (room, side) => {
        const left = room.x;
        const top = room.y;
        const right = room.x + room.w - 1;
        const bottom = room.y + room.h - 1;
        const points = [];
        if (side === 'left' || side === 'right') {
          const x = side === 'left' ? left : right;
          for (let y = top + 1; y <= bottom - 1; y += 1) {
            points.push({ x, y });
          }
        } else {
          const y = side === 'top' ? top : bottom;
          for (let x = left + 1; x <= right - 1; x += 1) {
            points.push({ x, y });
          }
        }
        // 尺寸为 3x3 时只有一个合法点；理论上不会为空，但保底取中心点。
        if (!points.length) {
          points.push(roomCenter(room));
        }
        return points;
      };
      const pickExit = (room, preferredSide, targetPoint) => {
        const candidates = getBoundaryPoints(room, preferredSide);
        let best = candidates[0];
        let bestDist = Number.POSITIVE_INFINITY;
        for (const point of candidates) {
          const dist = (point.x - targetPoint.x) ** 2 + (point.y - targetPoint.y) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            best = point;
          }
        }
        return best;
      };

      const exitA = pickExit(roomA, sidePriority[0], centerB);
      const exitB = pickExit(roomB, sidePriority[1], centerA);
      if (random() < 0.5) {
        carveLine(exitA.x, exitA.y, exitB.x, exitA.y);
        carveLine(exitB.x, exitA.y, exitB.x, exitB.y);
      } else {
        carveLine(exitA.x, exitA.y, exitA.x, exitB.y);
        carveLine(exitA.x, exitB.y, exitB.x, exitB.y);
      }
    };

    for (let attempt = 0; attempt < roomAttempts && rooms.length < roomTarget; attempt += 1) {
      const roomW = roomSizeOptions[Math.floor(random() * roomSizeOptions.length)];
      const roomH = roomSizeOptions[Math.floor(random() * roomSizeOptions.length)];
      const area = roomW * roomH;
      if (area < 9 || area > 25) {
        continue;
      }
      const maxX = mapWidth - roomW - 1;
      const maxY = mapHeight - roomH - 1;
      if (maxX <= 1 || maxY <= 1) {
        continue;
      }
      const x = 1 + Math.floor(random() * (maxX - 1 + 1));
      const y = 1 + Math.floor(random() * (maxY - 1 + 1));
      const room = { x, y, w: roomW, h: roomH };
      if (rooms.some((placed) => overlaps(room, placed, 1))) {
        continue;
      }
      rooms.push(room);
      carveRoom(room);
    }

    if (!rooms.length) {
      const fallback = { x: 2, y: 2, w: 3, h: 3 };
      rooms.push(fallback);
      carveRoom(fallback);
    }

    if (rooms.length > 1) {
      const edgeSet = new Set();
      const connectRooms = (i, j) => {
        if (i === j) {
          return;
        }
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const key = `${a}-${b}`;
        if (edgeSet.has(key)) {
          return;
        }
        edgeSet.add(key);
        carveCorridorBetweenRooms(rooms[a], rooms[b]);
      };

      for (let i = 1; i < rooms.length; i += 1) {
        let nearestIndex = 0;
        let nearestDist = Number.POSITIVE_INFINITY;
        const centerI = roomCenter(rooms[i]);
        for (let j = 0; j < i; j += 1) {
          const centerJ = roomCenter(rooms[j]);
          const dist = (centerI.x - centerJ.x) ** 2 + (centerI.y - centerJ.y) ** 2;
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIndex = j;
          }
        }
        connectRooms(i, nearestIndex);
      }

      const extraConnections = Math.max(1, Math.floor(rooms.length / 2));
      let extrasAdded = 0;
      for (let attempt = 0; attempt < rooms.length * rooms.length && extrasAdded < extraConnections; attempt += 1) {
        const i = Math.floor(random() * rooms.length);
        const j = Math.floor(random() * rooms.length);
        if (i === j) {
          continue;
        }
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const key = `${a}-${b}`;
        if (edgeSet.has(key)) {
          continue;
        }
        connectRooms(a, b);
        extrasAdded += 1;
      }

      const buildReachableSet = (origin) => {
        const visited = new Set();
        const queue = [origin];
        visited.add(`${origin.x},${origin.y}`);
        const stepDirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ];

        while (queue.length) {
          const current = queue.shift();
          for (const [dx, dy] of stepDirs) {
            const nx = current.x + dx;
            const ny = current.y + dy;
            if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) {
              continue;
            }
            if (grid[ny][nx] !== 0) {
              continue;
            }
            const key = `${nx},${ny}`;
            if (visited.has(key)) {
              continue;
            }
            visited.add(key);
            queue.push({ x: nx, y: ny });
          }
        }

        return visited;
      };

      const ensureRoomConnectivity = () => {
        const centers = rooms.map(roomCenter);
        let safeguard = rooms.length * 4;
        while (safeguard > 0) {
          safeguard -= 1;
          const reachable = buildReachableSet(centers[0]);
          const connectedIndexes = [];
          const disconnectedIndexes = [];
          for (let i = 0; i < centers.length; i += 1) {
            const key = `${centers[i].x},${centers[i].y}`;
            if (reachable.has(key)) {
              connectedIndexes.push(i);
            } else {
              disconnectedIndexes.push(i);
            }
          }
          if (!disconnectedIndexes.length) {
            break;
          }
          for (const disconnectedIndex of disconnectedIndexes) {
            let targetIndex = connectedIndexes[0];
            let bestDist = Number.POSITIVE_INFINITY;
            for (const connectedIndex of connectedIndexes) {
              const dist = (centers[disconnectedIndex].x - centers[connectedIndex].x) ** 2
                + (centers[disconnectedIndex].y - centers[connectedIndex].y) ** 2;
              if (dist < bestDist) {
                bestDist = dist;
                targetIndex = connectedIndex;
              }
            }
            carveCorridorBetweenRooms(rooms[disconnectedIndex], rooms[targetIndex]);
          }
        }
      };

      ensureRoomConnectivity();
    }

    const getRoomInteriorPoints = (room) => {
      const points = [];
      for (let y = room.y + 1; y <= room.y + room.h - 2; y += 1) {
        for (let x = room.x + 1; x <= room.x + room.w - 2; x += 1) {
          points.push({ x, y });
        }
      }
      if (!points.length) {
        points.push(roomCenter(room));
      }
      return points;
    };
    const roomInteriorPoints = rooms.map(getRoomInteriorPoints);
    const pickRandomPoint = (points) => points[Math.floor(random() * points.length)];
    const startRoomIndex = Math.floor(random() * rooms.length);
    const start = pickRandomPoint(roomInteriorPoints[startRoomIndex]) || roomCenter(rooms[startRoomIndex]);

    const buildDistanceMap = (origin) => {
      const distances = Array.from({ length: mapHeight }, () => Array(mapWidth).fill(-1));
      const queue = [{ x: origin.x, y: origin.y, dist: 0 }];
      distances[origin.y][origin.x] = 0;
      const stepDirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ];

      while (queue.length) {
        const current = queue.shift();
        for (const [dx, dy] of stepDirs) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) {
            continue;
          }
          if (grid[ny][nx] !== 0) {
            continue;
          }
          if (distances[ny][nx] >= 0) {
            continue;
          }
          const nextDist = current.dist + 1;
          distances[ny][nx] = nextDist;
          queue.push({ x: nx, y: ny, dist: nextDist });
        }
      }

      return distances;
    };
    const distanceMap = buildDistanceMap(start);
    const selectFarthestRoomEnd = (preferDifferentRoom = true) => {
      let bestPoint = null;
      let bestDistance = -1;
      for (let i = 0; i < roomInteriorPoints.length; i += 1) {
        if (preferDifferentRoom && i === startRoomIndex) {
          continue;
        }
        for (const point of roomInteriorPoints[i]) {
          const distance = distanceMap[point.y] && distanceMap[point.y][point.x];
          if (distance === undefined || distance < 0) {
            continue;
          }
          if (distance > bestDistance) {
            bestDistance = distance;
            bestPoint = point;
          }
        }
      }
      return bestPoint;
    };

    const end = selectFarthestRoomEnd(true)
      || selectFarthestRoomEnd(false)
      || { x: start.x, y: start.y };
    return {
      width: mapWidth,
      height: mapHeight,
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
      map: grid,
      rooms,
      map_rows: grid.map((row) => row.map((cell) => (cell === 1 ? '#' : '.')).join(''))
    };
  };
  const clampToMap = (roomState, x, y) => {
    const nx = Math.max(0, Math.min(roomState.width - 1, x));
    const ny = Math.max(0, Math.min(roomState.height - 1, y));
    return { x: nx, y: ny };
  };
  const isWalkableCell = (roomState, x, y) => {
    if (!roomState || !Array.isArray(roomState.map)) {
      return false;
    }
    if (x < 0 || y < 0 || x >= roomState.width || y >= roomState.height) {
      return false;
    }
    return roomState.map[y] && roomState.map[y][x] === 0;
  };
  const pickSpawnPoint = (roomState) => {
    const random = createSeededRandom(roomState.seed + roomState.round + Number(socket.userId || 0));
    const occupied = new Set(Array.from(roomState.players.values()).map((player) => `${player.x},${player.y}`));
    const interiorCandidates = [];
    const rooms = Array.isArray(roomState.rooms) ? roomState.rooms : [];
    for (const room of shuffleByRandom(rooms, random)) {
      for (let y = room.y + 1; y <= room.y + room.h - 2; y += 1) {
        for (let x = room.x + 1; x <= room.x + room.w - 2; x += 1) {
          interiorCandidates.push({ x, y });
        }
      }
    }

    for (const candidate of interiorCandidates) {
      const key = `${candidate.x},${candidate.y}`;
      if (occupied.has(key)) {
        continue;
      }
      if (candidate.x === roomState.end.x && candidate.y === roomState.end.y) {
        continue;
      }
      if (!isWalkableCell(roomState, candidate.x, candidate.y)) {
        continue;
      }
      return { x: candidate.x, y: candidate.y };
    }

    for (let i = 0; i < 600; i += 1) {
      const x = 1 + Math.floor(random() * (roomState.width - 2));
      const y = 1 + Math.floor(random() * (roomState.height - 2));
      if (!isWalkableCell(roomState, x, y)) {
        continue;
      }
      const key = `${x},${y}`;
      if (occupied.has(key)) {
        continue;
      }
      if (x === roomState.end.x && y === roomState.end.y) {
        continue;
      }
      return { x, y };
    }
    return { x: roomState.start.x, y: roomState.start.y };
  };
  const createGamePlayer = (roomState, nickname) => {
    const spawn = pickSpawnPoint(roomState);
    return {
      user_id: Number(socket.userId),
      username: socket.username,
      nickname,
      x: spawn.x,
      y: spawn.y,
      moves: 0,
      last_move_at: Date.now(),
      color: GAME_COLORS[Math.abs(Number(socket.userId || 0)) % GAME_COLORS.length],
      updated_at: new Date().toISOString()
    };
  };
  const getOrCreateGameRoomState = (roomId, seedValue) => {
    const roomKey = roomKeyOf(roomId);
    if (!gameRoomStates.has(roomKey)) {
      const seed = Number.parseInt(seedValue, 10) || (roomId * 7919 + 97);
      const dungeon = generateDungeonFromSeed(seed, GAME_MAP_WIDTH, GAME_MAP_HEIGHT);
      gameRoomStates.set(roomKey, {
        room_id: roomId,
        seed,
        width: dungeon.width,
        height: dungeon.height,
        map: dungeon.map,
        map_rows: dungeon.map_rows,
        rooms: dungeon.rooms,
        start: dungeon.start,
        end: dungeon.end,
        round: 1,
        phase: 'playing',
        winner_user_id: null,
        winner_name: '',
        updated_at: new Date().toISOString(),
        players: new Map()
      });
    }
    return gameRoomStates.get(roomKey);
  };
  const hasGameRoomState = (roomId) => gameRoomStates.has(roomKeyOf(roomId));
  const removePlayerFromGameRoom = (roomId, userId) => {
    const roomKey = roomKeyOf(roomId);
    if (!gameRoomStates.has(roomKey)) {
      return;
    }
    const roomState = gameRoomStates.get(roomKey);
    roomState.players.delete(userId);
    roomState.updated_at = new Date().toISOString();
    if (roomState.players.size === 0) {
      gameRoomStates.delete(roomKey);
    }
  };
  const buildGameStatePayload = (roomId, hintText = '') => {
    const roomState = getOrCreateGameRoomState(roomId);
    const players = Array.from(roomState.players.values());
    const entities = players.map((player) => ({
      x: player.x,
      y: player.y,
      color: player.color || '#ff9c4d'
    }));
    const leading = players.slice().sort((a, b) => Number(b.moves || 0) - Number(a.moves || 0))[0];

    return {
      room_id: roomId,
      seed: roomState.seed,
      width: roomState.width,
      height: roomState.height,
      map: roomState.map_rows,
      end: roomState.end,
      vision_radius: 3,
      player_unit_size: 1,
      player_speed_units_per_sec: PLAYER_SPEED_UNITS_PER_SEC,
      move_interval_ms: PLAYER_MOVE_INTERVAL_MS,
      round: roomState.round,
      phase: roomState.phase,
      score: leading ? Number(leading.moves || 0) : 0,
      result: roomState.phase === 'finished'
        ? `胜利者: ${roomState.winner_name || '未知'}`
        : '探索中',
      hint: hintText || '使用 WASD 或方向键移动到终点',
      winner_user_id: roomState.winner_user_id,
      winner_name: roomState.winner_name,
      game_over: roomState.phase === 'finished',
      return_delay_ms: roomState.phase === 'finished' ? 2400 : 0,
      room_url: `/?resumeRoomId=${roomId}`,
      players,
      entities,
      updated_at: roomState.updated_at
    };
  };
  const emitGameStateUpdate = (roomId, hintText = '') => {
    const payload = buildGameStatePayload(roomId, hintText);
    io.to(gameRoomKeyOf(roomId)).emit('gameStateUpdate', payload);
  };
  const emitGameError = (message, callback) => {
    const payload = { message: message || '游戏事件处理失败' };
    socket.emit('error', payload);
    reply(callback, { ok: false, message: payload.message });
  };
  const emitGameNotice = (roomId, message) => {
    io.to(gameRoomKeyOf(roomId)).emit('notice', { message });
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
          const onlineMembers = roomMembers.get(roomKey);
          const wasAlreadyOnline = onlineMembers.has(socket.userId);
          onlineMembers.add(socket.userId);

          if (!wasAlreadyOnline) {
            setRoomReadyState(roomId, socket.userId, false);
            recordRoomEvent(roomId, 'join');
          }

          emitRoomLobbyUpdate(roomId);

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
    clearRoomReadyState(roomId, socket.userId);

    recordRoomEvent(roomId, 'leave');
    emitRoomLobbyUpdate(roomId);

    if (parseGameRoomId(socket.data.gameRoomId) === roomId) {
      socket.leave(gameRoomKeyOf(roomId));
      socket.data.gameRoomId = null;
      removePlayerFromGameRoom(roomId, socket.userId);
      if (hasGameRoomState(roomId)) {
        emitGameNotice(roomId, `${socket.username} 离开了游戏`);
        emitGameStateUpdate(roomId, `${socket.username} 离开了游戏`);
      }
    }
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

      buildRoomLobbySnapshot(roomId, (snapshotErr, snapshot) => {
        if (snapshotErr) {
          reply(callback, { ok: false, message: '数据库错误' });
          return;
        }

        reply(callback, {
          ok: true,
          ...snapshot,
          is_owner: Number(snapshot.owner_id) === Number(socket.userId)
        });
      });
    });
  });

  // 设置准备状态（WebSocket）
  socket.on('room:ready:set', (data, callback) => {
    const roomId = parseRoomId(data && data.room_id);
    const ready = !!(data && data.ready);

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

      setRoomReadyState(roomId, socket.userId, ready);
      recordRoomEvent(roomId, ready ? 'ready' : 'unready');
      emitRoomLobbyUpdate(roomId);
      reply(callback, { ok: true, ready });
    });
  });

  // 房主开始游戏（WebSocket）
  socket.on('room:game:start', (data, callback) => {
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

      buildRoomLobbySnapshot(roomId, (snapshotErr, snapshot) => {
        if (snapshotErr) {
          reply(callback, { ok: false, message: '数据库错误' });
          return;
        }

        if (Number(snapshot.owner_id) !== Number(socket.userId)) {
          reply(callback, { ok: false, message: '只有房主可以开始游戏' });
          return;
        }

        if (!snapshot.all_online_ready) {
          const unready = (snapshot.members || [])
            .filter((member) => member.online && !member.ready)
            .map((member) => member.username);
          reply(callback, {
            ok: false,
            message: `仍有玩家未准备：${unready.join('、') || '未知玩家'}`
          });
          return;
        }

        const startedAt = new Date().toISOString();
        const gameSeed = Date.now();
        const gameUrl = `/game/?roomId=${roomId}&seed=${gameSeed}`;
        recordRoomEvent(roomId, 'game_start', {
          content: `${socket.username} 开始了游戏`
        });
        io.to(`room:${roomId}`).emit('room:game:started', {
          room_id: roomId,
          game_url: gameUrl,
          game_seed: gameSeed,
          started_by: socket.username,
          started_at: startedAt
        });
        reply(callback, {
          ok: true,
          room_id: roomId,
          game_url: gameUrl,
          game_seed: gameSeed,
          started_by: socket.username,
          started_at: startedAt
        });
      });
    });
  });

  // 加入游戏房间（Socket.IO）
  socket.on('joinGame', (payload, callback) => {
    const roomId = resolveGameRoomId(payload || {});
    if (!roomId) {
      emitGameError('无效的游戏房间ID', callback);
      return;
    }

    isJoinedRoom(roomId, (err, hasAccess) => {
      if (err) {
        emitGameError('数据库错误', callback);
        return;
      }
      if (!hasAccess) {
        emitGameError('你不在这个房间，无法加入游戏', callback);
        return;
      }

      const currentGameRoomId = parseGameRoomId(socket.data.gameRoomId);
      if (currentGameRoomId && currentGameRoomId !== roomId) {
        socket.leave(gameRoomKeyOf(currentGameRoomId));
        removePlayerFromGameRoom(currentGameRoomId, socket.userId);
        if (hasGameRoomState(currentGameRoomId)) {
          emitGameStateUpdate(currentGameRoomId, `${socket.username} 离开了游戏`);
        }
      }

      socket.join(gameRoomKeyOf(roomId));
      socket.data.gameRoomId = roomId;

      const roomState = getOrCreateGameRoomState(roomId, payload?.seed);
      const nickname = typeof payload?.nickname === 'string' && payload.nickname.trim()
        ? payload.nickname.trim().slice(0, 20)
        : socket.username;
      const existing = roomState.players.get(socket.userId);
      const player = existing
        ? {
            ...existing,
            username: socket.username,
            nickname,
            last_move_at: Number(existing.last_move_at || Date.now()),
            updated_at: new Date().toISOString()
          }
        : createGamePlayer(roomState, nickname);

      roomState.players.set(socket.userId, player);
      roomState.updated_at = new Date().toISOString();
      roomState.round += 1;

      const message = `${player.nickname || socket.username} 进入地牢，前往终点`;
      emitGameNotice(roomId, message);
      emitGameStateUpdate(roomId, message);

      reply(callback, {
        ok: true,
        room_id: roomId,
        seed: roomState.seed,
        end: roomState.end,
        player
      });
    });
  });

  // 游戏动作（Socket.IO）
  socket.on('playerAction', (payload, callback) => {
    const roomId = resolveGameRoomId(payload || {});
    if (!roomId) {
      emitGameError('无效的游戏房间ID', callback);
      return;
    }

    isJoinedRoom(roomId, (err, hasAccess) => {
      if (err) {
        emitGameError('数据库错误', callback);
        return;
      }
      if (!hasAccess) {
        emitGameError('你不在这个房间，无法进行游戏操作', callback);
        return;
      }

      const roomState = getOrCreateGameRoomState(roomId);
      if (!roomState.players.has(socket.userId)) {
        roomState.players.set(socket.userId, createGamePlayer(roomState, socket.username));
      }

      const player = roomState.players.get(socket.userId);
      const action = typeof payload?.action === 'string' ? payload.action.trim() : '';
      if (!action) {
        emitGameError('缺少 action', callback);
        return;
      }

      if (roomState.phase === 'finished') {
        emitGameError('游戏已结束，正在返回房间', callback);
        return;
      }

      const actionKey = action.toLowerCase();
      const movementByAction = {
        moveup: { dx: 0, dy: -1 },
        movedown: { dx: 0, dy: 1 },
        moveleft: { dx: -1, dy: 0 },
        moveright: { dx: 1, dy: 0 },
        w: { dx: 0, dy: -1 },
        s: { dx: 0, dy: 1 },
        a: { dx: -1, dy: 0 },
        d: { dx: 1, dy: 0 },
        arrowup: { dx: 0, dy: -1 },
        arrowdown: { dx: 0, dy: 1 },
        arrowleft: { dx: -1, dy: 0 },
        arrowright: { dx: 1, dy: 0 }
      };

      const step = movementByAction[actionKey];
      if (!step) {
        emitGameError(`不支持的动作: ${action}`, callback);
        return;
      }

      const now = Date.now();
      const lastMoveAt = Number(player.last_move_at || 0);
      const elapsed = now - lastMoveAt;
      if (elapsed < PLAYER_MOVE_INTERVAL_MS) {
        reply(callback, {
          ok: true,
          room_id: roomId,
          action,
          throttled: true,
          wait_ms: PLAYER_MOVE_INTERVAL_MS - elapsed
        });
        return;
      }

      const next = clampToMap(roomState, player.x + step.dx, player.y + step.dy);
      let moved = false;
      if (isWalkableCell(roomState, next.x, next.y)) {
        player.x = next.x;
        player.y = next.y;
        player.moves = Number(player.moves || 0) + 1;
        moved = true;
      }

      player.last_move_at = now;
      player.updated_at = new Date().toISOString();
      roomState.round += 1;
      roomState.updated_at = new Date().toISOString();

      if (player.x === roomState.end.x && player.y === roomState.end.y) {
        roomState.phase = 'finished';
        roomState.winner_user_id = Number(socket.userId);
        roomState.winner_name = player.nickname || socket.username;
        const finishMessage = `游戏结束：${roomState.winner_name} 到达终点`;
        emitGameNotice(roomId, finishMessage);
        emitGameStateUpdate(roomId, finishMessage);
        reply(callback, {
          ok: true,
          room_id: roomId,
          action,
          finished: true
        });
        return;
      }

      const message = moved
        ? `${player.nickname || socket.username} 向前移动`
        : `${player.nickname || socket.username} 撞到了墙`;
      emitGameStateUpdate(roomId, message);
      reply(callback, { ok: true, room_id: roomId, action });
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

    const gameRoomId = parseGameRoomId(socket.data.gameRoomId);
    if (gameRoomId) {
      socket.data.gameRoomId = null;
      removePlayerFromGameRoom(gameRoomId, socket.userId);
      if (hasGameRoomState(gameRoomId)) {
        emitGameNotice(gameRoomId, `${socket.username} 断开了连接`);
        emitGameStateUpdate(gameRoomId, `${socket.username} 断开了连接`);
      }
    }

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

        clearRoomReadyState(roomId, socket.userId);

        // 记录离开事件
        recordRoomEvent(roomId, 'leave');
        emitRoomLobbyUpdate(roomId);
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
