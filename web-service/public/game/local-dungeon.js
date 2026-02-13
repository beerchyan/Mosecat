(function () {
  "use strict";

  const MAP_WIDTH = 60;
  const MAP_HEIGHT = 60;
  const TILE_SIZE = 16;
  const LOG_LIMIT = 80;
  const DUNGEON_GEN_RULES = {
    minRoomDistance: 5,
    doorMinPerRoom: 1,
    doorMaxPerRoom: 2,
    maxGenerateRetries: 80
  };

  const FALLBACK_GLYPH = {
    floor: ".",
    player: "P",
    monster: "M",
    item: "O",
    door: "D",
    wall: "W"
  };
  const CARDINAL_DIRS = [
    { name: "N", dx: 0, dy: -1 },
    { name: "E", dx: 1, dy: 0 },
    { name: "S", dx: 0, dy: 1 },
    { name: "W", dx: -1, dy: 0 }
  ];

  const state = {
    config: null,
    atlasImage: null,
    canvas: null,
    ctx: null,
    tilesByIndex: new Map(),
    map: [],
    floors: new Set(),
    doors: new Set(),
    roomFloors: new Set(),
    roomWallTypes: new Map(),
    corridorCells: new Set(),
    corridorEdgeCells: new Set(),
    corridorBoundaryWalls: new Map(),
    corridorBoundaryWallTypes: new Map(),
    corridorSegments: [],
    floorTileByCell: new Map(),
    wallTileByCell: new Map(),
    doorTileByCell: new Map(),
    entityTileByKind: {
      player: null,
      monster: null,
      item: null
    },
    player: null,
    monsters: new Map(),
    items: new Set(),
    kills: 0,
    pickedItems: 0,
    gameOver: false,
    renderMode: "tile"
  };

  function cellKey(x, y) {
    return x + "," + y;
  }

  function parseCellKey(key) {
    const parts = key.split(",");
    return { x: Number(parts[0]), y: Number(parts[1]) };
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomChoice(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return null;
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function shuffleInPlace(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function getRoomWallBounds(room) {
    return {
      left: room.getLeft() - 1,
      right: room.getRight() + 1,
      top: room.getTop() - 1,
      bottom: room.getBottom() + 1
    };
  }

  function axisGap(aMin, aMax, bMin, bMax) {
    if (aMin > bMax) {
      return aMin - bMax - 1;
    }
    if (bMin > aMax) {
      return bMin - aMax - 1;
    }
    return 0;
  }

  function roomGap(roomA, roomB) {
    const a = getRoomWallBounds(roomA);
    const b = getRoomWallBounds(roomB);
    const gapX = axisGap(a.left, a.right, b.left, b.right);
    const gapY = axisGap(a.top, a.bottom, b.top, b.bottom);
    return Math.max(gapX, gapY);
  }

  function roomsMeetMinDistance(rooms, minDistance) {
    if (!Number.isFinite(minDistance) || minDistance <= 0) {
      return true;
    }
    for (let i = 0; i < rooms.length; i += 1) {
      for (let j = i + 1; j < rooms.length; j += 1) {
        if (roomGap(rooms[i], rooms[j]) < minDistance) {
          return false;
        }
      }
    }
    return true;
  }

  function pickDoorKeysForRoom(doorKeys, minDoors, maxDoors) {
    if (!Array.isArray(doorKeys) || doorKeys.length === 0) {
      return new Set();
    }

    const uniqueKeys = Array.from(new Set(doorKeys));
    const safeMin = Math.max(0, Math.min(minDoors, uniqueKeys.length));
    const safeMax = Math.max(safeMin, Math.min(maxDoors, uniqueKeys.length));
    const target = randomInt(safeMin, safeMax);

    shuffleInPlace(uniqueKeys);
    return new Set(uniqueKeys.slice(0, target));
  }

  function addLog(message) {
    const list = document.getElementById("log");
    if (!list) {
      return;
    }
    const item = document.createElement("li");
    item.textContent = message;
    list.prepend(item);
    while (list.children.length > LOG_LIMIT) {
      list.removeChild(list.lastElementChild);
    }
  }

  function updateStats() {
    const hpValue = document.getElementById("hpValue");
    const itemsValue = document.getElementById("itemsValue");
    const killsValue = document.getElementById("killsValue");
    const monstersValue = document.getElementById("monstersValue");

    if (hpValue) {
      hpValue.textContent = String(Math.max(0, state.player ? state.player.hp : 0));
    }
    if (itemsValue) {
      itemsValue.textContent = String(state.pickedItems);
    }
    if (killsValue) {
      killsValue.textContent = String(state.kills);
    }
    if (monstersValue) {
      monstersValue.textContent = String(state.monsters.size);
    }
  }

  function updateRenderModeButton() {
    const btn = document.getElementById("renderModeBtn");
    if (!btn) {
      return;
    }
    if (state.renderMode === "tile") {
      btn.textContent = "切换到符号渲染";
    } else {
      btn.textContent = "切换到图片渲染";
    }
  }

  function getVariantTileIndex(variant, fallbackIndex) {
    if (!variant) {
      return Number.isInteger(fallbackIndex) ? fallbackIndex : null;
    }

    if (Array.isArray(variant.tileIndices) && variant.tileIndices.length > 0) {
      const idx = randomChoice(variant.tileIndices);
      return Number.isInteger(idx) ? idx : fallbackIndex;
    }

    if (Number.isInteger(variant.tileIndex)) {
      return variant.tileIndex;
    }

    return Number.isInteger(fallbackIndex) ? fallbackIndex : null;
  }

  function collectVariantIndices(variant, targetSet) {
    if (!variant || !targetSet) {
      return;
    }
    if (Array.isArray(variant.tileIndices)) {
      variant.tileIndices.forEach((idx) => {
        if (Number.isInteger(idx)) {
          targetSet.add(idx);
        }
      });
    }
    if (Number.isInteger(variant.tileIndex)) {
      targetSet.add(variant.tileIndex);
    }
  }

  function getVariantTileIndexExcluding(variant, fallbackIndex, excludedSet) {
    const isExcluded = (idx) => {
      return Boolean(excludedSet && Number.isInteger(idx) && excludedSet.has(idx));
    };

    if (!variant) {
      return Number.isInteger(fallbackIndex) && !isExcluded(fallbackIndex) ? fallbackIndex : null;
    }

    if (Array.isArray(variant.tileIndices) && variant.tileIndices.length > 0) {
      const valid = variant.tileIndices.filter((idx) => Number.isInteger(idx) && !isExcluded(idx));
      if (valid.length > 0) {
        return randomChoice(valid);
      }
    }

    if (Number.isInteger(variant.tileIndex) && !isExcluded(variant.tileIndex)) {
      return variant.tileIndex;
    }

    return Number.isInteger(fallbackIndex) && !isExcluded(fallbackIndex) ? fallbackIndex : null;
  }

  function getConfigTileByIndex(index) {
    if (!Number.isInteger(index)) {
      return null;
    }
    return state.tilesByIndex.get(index) || null;
  }

  function drawAtlasTile(tileIndex, x, y) {
    const tile = getConfigTileByIndex(tileIndex);
    if (!tile || !state.ctx || !state.atlasImage || !state.config) {
      return false;
    }

    const atlas = state.config.atlas || {};
    const tileWidth = atlas.tileWidth || TILE_SIZE;
    const tileHeight = atlas.tileHeight || TILE_SIZE;

    state.ctx.drawImage(
      state.atlasImage,
      tile.pixelX,
      tile.pixelY,
      tileWidth,
      tileHeight,
      x * TILE_SIZE,
      y * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE
    );

    return true;
  }

  function drawGlyph(glyph, x, y, color) {
    if (!state.ctx) {
      return;
    }
    state.ctx.save();
    state.ctx.font = "14px 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    state.ctx.fillStyle = color || "#ffffff";
    state.ctx.textAlign = "center";
    state.ctx.textBaseline = "middle";
    state.ctx.fillText(glyph, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2 + 1);
    state.ctx.restore();
  }

  function isFloor(x, y) {
    return state.floors.has(cellKey(x, y));
  }

  function isDoor(x, y) {
    return state.doors.has(cellKey(x, y));
  }

  function isPassable(x, y) {
    if (!inBounds(x, y)) {
      return false;
    }
    return isFloor(x, y) || isDoor(x, y);
  }

  function isWallCell(x, y) {
    if (!inBounds(x, y)) {
      return false;
    }
    return state.map[y][x] === 1 && !isDoor(x, y);
  }

  function getDoorOrientation(x, y) {
    const left = isPassable(x - 1, y);
    const right = isPassable(x + 1, y);
    const up = isPassable(x, y - 1);
    const down = isPassable(x, y + 1);

    const horizontalScore = (left ? 1 : 0) + (right ? 1 : 0);
    const verticalScore = (up ? 1 : 0) + (down ? 1 : 0);

    return horizontalScore >= verticalScore ? "horizontal" : "vertical";
  }

  function getDoorVariantType(x, y) {
    const orientation = getDoorOrientation(x, y);
    if (orientation === "horizontal") {
      return "horizontal";
    }

    const leftWall = isWallCell(x - 1, y);
    const rightWall = isWallCell(x + 1, y);

    if (leftWall && !rightWall) {
      return "verticalNearLeftWall";
    }
    if (rightWall && !leftWall) {
      return "verticalNearRightWall";
    }

    return "vertical";
  }

  function pickFloorTileType(x, y) {
    const key = cellKey(x, y);
    if (state.roomFloors.has(key)) {
      return "room";
    }

    if (isDoor(x, y)) {
      if (
        state.roomFloors.has(cellKey(x - 1, y)) ||
        state.roomFloors.has(cellKey(x + 1, y)) ||
        state.roomFloors.has(cellKey(x, y - 1)) ||
        state.roomFloors.has(cellKey(x, y + 1))
      ) {
        return "room";
      }
    }

    return "corridor";
  }

  function buildRoomEdgeTypes(rooms) {
    state.roomWallTypes.clear();

    function mark(x, y, type) {
      if (!inBounds(x, y)) {
        return;
      }
      const key = cellKey(x, y);
      if (isDoor(x, y)) {
        return;
      }
      if (!isWallCell(x, y)) {
        return;
      }
      state.roomWallTypes.set(key, type);
    }

    rooms.forEach((room) => {
      const left = room.getLeft();
      const right = room.getRight();
      const top = room.getTop();
      const bottom = room.getBottom();

      // Room methods return inner floor bounds, so walls are one tile outside.
      const wallLeft = left - 1;
      const wallRight = right + 1;
      const wallTop = top - 1;
      const wallBottom = bottom + 1;

      mark(wallLeft, wallTop, "cornerTopLeft");
      mark(wallRight, wallTop, "cornerTopRight");
      mark(wallLeft, wallBottom, "cornerBottomLeft");
      mark(wallRight, wallBottom, "cornerBottomRight");

      for (let x = left; x <= right; x += 1) {
        mark(x, wallTop, "top");
        mark(x, wallBottom, "bottom");
      }
      for (let y = top; y <= bottom; y += 1) {
        mark(wallLeft, y, "left");
        mark(wallRight, y, "right");
      }
    });
  }

  function buildCorridorData(corridors) {
    state.corridorCells.clear();
    state.corridorEdgeCells.clear();
    state.corridorBoundaryWalls.clear();
    state.corridorBoundaryWallTypes.clear();
    state.corridorSegments = [];

    function markBoundaryWall(x, y, touchDir) {
      if (!inBounds(x, y) || !isWallCell(x, y)) {
        return;
      }
      const wallKey = cellKey(x, y);
      const existing = state.corridorBoundaryWalls.get(wallKey);
      if (existing) {
        if (!existing.touchDirs.includes(touchDir)) {
          existing.touchDirs.push(touchDir);
        }
      } else {
        state.corridorBoundaryWalls.set(wallKey, {
          x,
          y,
          touchDirs: [touchDir]
        });
      }
    }

    function forceWallCell(x, y, touchDir, extraTouchDir) {
      if (!inBounds(x, y)) {
        return;
      }
      const key = cellKey(x, y);
      if (state.corridorCells.has(key) || state.doors.has(key)) {
        return;
      }

      state.map[y][x] = 1;
      state.floors.delete(key);
      state.roomFloors.delete(key);
      markBoundaryWall(x, y, touchDir);
      if (extraTouchDir) {
        markBoundaryWall(x, y, extraTouchDir);
      }
    }

    if (Array.isArray(corridors)) {
      state.corridorSegments = corridors.map((corridor, index) => {
        const seg = { id: index, start: null, end: null, direction: null, length: 0, cells: [] };
        if (
          corridor &&
          typeof corridor.getStartX === "function" &&
          typeof corridor.getStartY === "function" &&
          typeof corridor.getEndX === "function" &&
          typeof corridor.getEndY === "function"
        ) {
          seg.start = { x: corridor.getStartX(), y: corridor.getStartY() };
          seg.end = { x: corridor.getEndX(), y: corridor.getEndY() };
          const dx = Math.sign(seg.end.x - seg.start.x);
          const dy = Math.sign(seg.end.y - seg.start.y);
          if (dx !== 0) {
            seg.direction = "horizontal";
          } else if (dy !== 0) {
            seg.direction = "vertical";
          } else {
            seg.direction = "point";
          }

          let cx = seg.start.x;
          let cy = seg.start.y;
          const maxSteps = MAP_WIDTH * MAP_HEIGHT;
          for (let step = 0; step < maxSteps; step += 1) {
            seg.cells.push({ x: cx, y: cy, key: cellKey(cx, cy) });
            if (cx === seg.end.x && cy === seg.end.y) {
              break;
            }
            cx += dx;
            cy += dy;
          }
          seg.length = seg.cells.length;
        }
        return seg;
      });
    }

    const orientationByCorridorCell = new Map();
    state.corridorSegments.forEach((seg) => {
      const dir = seg.direction;
      if (!dir || dir === "point" || !Array.isArray(seg.cells)) {
        return;
      }
      seg.cells.forEach((cell) => {
        const list = orientationByCorridorCell.get(cell.key);
        if (list) {
          if (!list.includes(dir)) {
            list.push(dir);
          }
        } else {
          orientationByCorridorCell.set(cell.key, [dir]);
        }
      });
    });

    state.floors.forEach((key) => {
      if (state.roomFloors.has(key) || state.doors.has(key)) {
        return;
      }
      state.corridorCells.add(key);
    });

    function isCorridorOrDoor(x, y) {
      if (!inBounds(x, y)) {
        return false;
      }
      const key = cellKey(x, y);
      return state.corridorCells.has(key) || state.doors.has(key);
    }

    state.corridorCells.forEach((key) => {
      const pos = parseCellKey(key);
      const open = { N: false, E: false, S: false, W: false };

      CARDINAL_DIRS.forEach((dir) => {
        const nx = pos.x + dir.dx;
        const ny = pos.y + dir.dy;
        if (isCorridorOrDoor(nx, ny)) {
          open[dir.name] = true;
          return;
        }
        forceWallCell(nx, ny, dir.name);
      });

      // Fill diagonal corner around corridor turns, avoiding visual corner gaps.
      if (open.N && open.E) {
        forceWallCell(pos.x + 1, pos.y - 1, "N", "E");
      }
      if (open.E && open.S) {
        forceWallCell(pos.x + 1, pos.y + 1, "E", "S");
      }
      if (open.S && open.W) {
        forceWallCell(pos.x - 1, pos.y + 1, "S", "W");
      }
      if (open.W && open.N) {
        forceWallCell(pos.x - 1, pos.y - 1, "W", "N");
      }

      const orientations = orientationByCorridorCell.get(key) || [];
      if (orientations.includes("horizontal")) {
        forceWallCell(pos.x, pos.y - 1, "N");
        forceWallCell(pos.x, pos.y + 1, "S");
      }
      if (orientations.includes("vertical")) {
        forceWallCell(pos.x - 1, pos.y, "W");
        forceWallCell(pos.x + 1, pos.y, "E");
      }

      if (!open.N || !open.E || !open.S || !open.W) {
        state.corridorEdgeCells.add(key);
      }
    });

    function resolveBoundaryWallType(touchDirs) {
      const n = touchDirs.includes("N");
      const e = touchDirs.includes("E");
      const s = touchDirs.includes("S");
      const w = touchDirs.includes("W");
      const count = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);

      if (n && w) {
        return "cornerTopLeft";
      }
      if (n && e) {
        return "cornerTopRight";
      }
      if (s && w) {
        return "cornerBottomLeft";
      }
      if (s && e) {
        return "cornerBottomRight";
      }
      if (n) {
        return "top";
      }
      if (s) {
        return "bottom";
      }
      if (w) {
        return "left";
      }
      if (e) {
        return "right";
      }

      // For multi-touch cases (usually around tight bends/intersections),
      // prefer a directional wall by missing side instead of dropping to void.
      if (count === 3) {
        if (!n) {
          return "top";
        }
        if (!s) {
          return "bottom";
        }
        if (!w) {
          return "left";
        }
        if (!e) {
          return "right";
        }
      }

      if (count >= 4) {
        return "void";
      }

      return "void";
    }

    state.corridorBoundaryWalls.forEach((wall, wallKey) => {
      state.corridorBoundaryWallTypes.set(wallKey, resolveBoundaryWallType(wall.touchDirs || []));
    });
  }

  function getCorridorDataSnapshot() {
    return {
      cellCount: state.corridorCells.size,
      edgeCellCount: state.corridorEdgeCells.size,
      boundaryWallCount: state.corridorBoundaryWalls.size,
      corridorCount: state.corridorSegments.length,
      cells: Array.from(state.corridorCells).map(parseCellKey),
      edgeCells: Array.from(state.corridorEdgeCells).map(parseCellKey),
      boundaryWalls: Array.from(state.corridorBoundaryWalls.values()),
      corridors: state.corridorSegments
    };
  }

  function exposeDataApi() {
    window.localDungeonData = {
      getCorridorData: getCorridorDataSnapshot
    };
  }

  function buildTerrainTileCache() {
    state.floorTileByCell.clear();
    state.wallTileByCell.clear();
    state.doorTileByCell.clear();

    const floorVariants = (state.config.floorVariants && state.config.floorVariants.types) || {};
    const roomWallVariants = (state.config.roomWallVariants && state.config.roomWallVariants.types) || {};
    const doorVariants = (state.config.doorVariants && state.config.doorVariants.types) || {};
    const fallbackWallMap = (state.config.wallBitmaskFallback && state.config.wallBitmaskFallback.mapping) || {};
    const voidWallVariant = roomWallVariants.void || null;
    const forbiddenFloorTileIndices = new Set();
    Object.values(doorVariants).forEach((variant) => collectVariantIndices(variant, forbiddenFloorTileIndices));

    const defaultFloorIdx = 0;
    const defaultWallIdx = 0;

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const key = cellKey(x, y);

        if (isPassable(x, y)) {
          const floorType = pickFloorTileType(x, y);
          const floorVariant = floorType === "room" ? floorVariants.room : floorVariants.corridor;
          const floorTile = getVariantTileIndexExcluding(
            floorVariant,
            defaultFloorIdx,
            isDoor(x, y) ? null : forbiddenFloorTileIndices
          );
          if (Number.isInteger(floorTile)) {
            state.floorTileByCell.set(key, floorTile);
          }
        }

        if (isWallCell(x, y)) {
          const roomType = state.roomWallTypes.get(key);
          const corridorType = state.corridorBoundaryWallTypes.get(key);
          let wallTile = null;

          if (roomType && roomWallVariants[roomType]) {
            wallTile = getVariantTileIndex(roomWallVariants[roomType], defaultWallIdx);
          } else if (corridorType && roomWallVariants[corridorType]) {
            wallTile = getVariantTileIndex(roomWallVariants[corridorType], defaultWallIdx);
          } else if (voidWallVariant) {
            wallTile = getVariantTileIndex(voidWallVariant, defaultWallIdx);
          } else {
            const n = isPassable(x, y - 1) ? "1" : "0";
            const e = isPassable(x + 1, y) ? "1" : "0";
            const s = isPassable(x, y + 1) ? "1" : "0";
            const w = isPassable(x - 1, y) ? "1" : "0";
            const bits = n + e + s + w;
            const fallbackEntry = fallbackWallMap[bits];
            wallTile = getVariantTileIndex(
              fallbackEntry,
              getVariantTileIndex(roomWallVariants.top, defaultWallIdx)
            );
          }

          if (Number.isInteger(wallTile)) {
            state.wallTileByCell.set(key, wallTile);
          }
        }

        if (isDoor(x, y)) {
          const variantType = getDoorVariantType(x, y);
          let variant = null;

          if (variantType === "horizontal") {
            variant = doorVariants.horizontal;
          } else if (variantType === "verticalNearLeftWall") {
            variant = doorVariants.verticalNearLeftWall || doorVariants.verticalLeft || doorVariants.vertical;
          } else if (variantType === "verticalNearRightWall") {
            variant = doorVariants.verticalNearRightWall || doorVariants.verticalRight || doorVariants.vertical;
          } else {
            variant = doorVariants.vertical;
          }

          const doorTile = getVariantTileIndex(variant, null);
          if (Number.isInteger(doorTile)) {
            state.doorTileByCell.set(key, doorTile);
          }
        }
      }
    }
  }

  function createMapData() {
    const maxRetries = Math.max(1, DUNGEON_GEN_RULES.maxGenerateRetries | 0);

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      state.map = Array.from({ length: MAP_HEIGHT }, () => Array(MAP_WIDTH).fill(1));
      state.floors.clear();
      state.doors.clear();
      state.roomFloors.clear();

      const digger = new ROT.Map.Digger(MAP_WIDTH, MAP_HEIGHT, {
        roomWidth: [4, 12],
        roomHeight: [4, 10],
        corridorLength: [3, 12],
        dugPercentage: 0.44,
        timeLimit: 1500
      });

      digger.create((x, y, value) => {
        state.map[y][x] = value === 1 ? 1 : 0;
        if (value !== 1) {
          state.floors.add(cellKey(x, y));
        }
      });

      const rooms = digger.getRooms();
      const corridors = digger.getCorridors();
      const spacingOk = roomsMeetMinDistance(rooms, DUNGEON_GEN_RULES.minRoomDistance);
      if (!spacingOk && attempt < maxRetries - 1) {
        continue;
      }

      rooms.forEach((room) => {
        const left = room.getLeft();
        const right = room.getRight();
        const top = room.getTop();
        const bottom = room.getBottom();
        for (let y = top; y <= bottom; y += 1) {
          for (let x = left; x <= right; x += 1) {
            const key = cellKey(x, y);
            state.roomFloors.add(key);
            state.floors.add(key);
            state.map[y][x] = 0;
          }
        }

        const roomDoorKeys = [];
        room.getDoors((doorX, doorY) => {
          if (!inBounds(doorX, doorY)) {
            return;
          }
          roomDoorKeys.push(cellKey(doorX, doorY));
        });

        const pickedDoorKeys = pickDoorKeysForRoom(
          roomDoorKeys,
          DUNGEON_GEN_RULES.doorMinPerRoom,
          DUNGEON_GEN_RULES.doorMaxPerRoom
        );

        roomDoorKeys.forEach((key) => {
          const p = parseCellKey(key);
          if (pickedDoorKeys.has(key)) {
            state.doors.add(key);
            state.floors.add(key);
            state.map[p.y][p.x] = 0;
            return;
          }
          state.doors.delete(key);
          state.floors.delete(key);
          state.map[p.y][p.x] = 1;
        });
      });

      buildRoomEdgeTypes(rooms);
      buildCorridorData(corridors);
      buildTerrainTileCache();
      return rooms;
    }

    return [];
  }

  function pickSpawnCells(count, forbiddenSet) {
    const candidates = [];
    state.floors.forEach((key) => {
      if (state.doors.has(key)) {
        return;
      }
      if (forbiddenSet && forbiddenSet.has(key)) {
        return;
      }
      candidates.push(key);
    });

    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }

    return candidates.slice(0, Math.max(0, count));
  }

  function createEntities(rooms) {
    state.monsters.clear();
    state.items.clear();
    state.kills = 0;
    state.pickedItems = 0;
    state.gameOver = false;

    let playerPos = null;
    if (rooms.length > 0) {
      const room = rooms[0];
      const px = Math.floor((room.getLeft() + room.getRight()) / 2);
      const py = Math.floor((room.getTop() + room.getBottom()) / 2);
      if (isPassable(px, py) && !isDoor(px, py)) {
        playerPos = cellKey(px, py);
      }
    }
    if (!playerPos) {
      const firstFloor = state.floors.values().next();
      playerPos = firstFloor.done ? "1,1" : firstFloor.value;
    }

    const p = parseCellKey(playerPos);
    state.player = {
      x: p.x,
      y: p.y,
      hp: 100
    };

    const forbidden = new Set([playerPos]);
    const floorCount = state.floors.size;
    const monsterCount = Math.max(18, Math.min(70, Math.floor(floorCount * 0.022)));
    const itemCount = Math.max(12, Math.min(45, Math.floor(floorCount * 0.015)));

    const monsterCells = pickSpawnCells(monsterCount, forbidden);
    monsterCells.forEach((key) => {
      forbidden.add(key);
      state.monsters.set(key, {
        hp: randomInt(24, 45),
        atkMin: 4,
        atkMax: 11
      });
    });

    const itemCells = pickSpawnCells(itemCount, forbidden);
    itemCells.forEach((key) => {
      state.items.add(key);
    });

    state.entityTileByKind.player = getEntityTileIndex("player");
    state.entityTileByKind.monster = getEntityTileIndex("monster");
    state.entityTileByKind.item = getEntityTileIndex("item");
  }

  function getEntityTileIndex(kind) {
    const objectConfig = state.config.gameObjectToTile || {};
    const node = objectConfig[kind];
    if (!node) {
      return null;
    }
    return getVariantTileIndex(node, null);
  }

  function render() {
    const ctx = state.ctx;
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);
    ctx.fillStyle = "#0d1a32";
    ctx.fillRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    if (state.renderMode === "glyph") {
      state.floors.forEach((key) => {
        const pos = parseCellKey(key);
        drawGlyph(FALLBACK_GLYPH.floor, pos.x, pos.y, "#8da2c6");
      });

      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        for (let x = 0; x < MAP_WIDTH; x += 1) {
          if (!isWallCell(x, y)) {
            continue;
          }
          drawGlyph(FALLBACK_GLYPH.wall, x, y);
        }
      }

      state.doors.forEach((key) => {
        const pos = parseCellKey(key);
        drawGlyph(FALLBACK_GLYPH.door, pos.x, pos.y);
      });

      state.items.forEach((key) => {
        const pos = parseCellKey(key);
        drawGlyph(FALLBACK_GLYPH.item, pos.x, pos.y);
      });

      state.monsters.forEach((monster, key) => {
        const pos = parseCellKey(key);
        drawGlyph(FALLBACK_GLYPH.monster, pos.x, pos.y);
      });

      drawGlyph(FALLBACK_GLYPH.player, state.player.x, state.player.y);
      return;
    }

    // Layer 1: floor (doors also get floor underlay first)
    state.floors.forEach((key) => {
      const pos = parseCellKey(key);
      const tileIndex = state.floorTileByCell.get(key);
      const drawn = drawAtlasTile(tileIndex, pos.x, pos.y);
      if (!drawn) {
        ctx.fillStyle = "#1f2f4e";
        ctx.fillRect(pos.x * TILE_SIZE, pos.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    });

    // Layer 2: walls
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        if (!isWallCell(x, y)) {
          continue;
        }
        const key = cellKey(x, y);
        const tileIndex = state.wallTileByCell.get(key);
        const drawn = drawAtlasTile(tileIndex, x, y);
        if (!drawn) {
          ctx.fillStyle = "#355074";
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          drawGlyph(FALLBACK_GLYPH.wall, x, y);
        }
      }
    }

    // Layer 3: doors on top of floor
    state.doors.forEach((key) => {
      const pos = parseCellKey(key);
      const tileIndex = state.doorTileByCell.get(key);
      const drawn = drawAtlasTile(tileIndex, pos.x, pos.y);
      if (!drawn) {
        drawGlyph(FALLBACK_GLYPH.door, pos.x, pos.y);
      }
    });

    // Layer 4: items
    const itemTileIndex = state.entityTileByKind.item;
    state.items.forEach((key) => {
      const pos = parseCellKey(key);
      const drawn = drawAtlasTile(itemTileIndex, pos.x, pos.y);
      if (!drawn) {
        drawGlyph(FALLBACK_GLYPH.item, pos.x, pos.y);
      }
    });

    // Layer 5: monsters
    const monsterTileIndex = state.entityTileByKind.monster;
    state.monsters.forEach((monster, key) => {
      const pos = parseCellKey(key);
      const drawn = drawAtlasTile(monsterTileIndex, pos.x, pos.y);
      if (!drawn) {
        drawGlyph(FALLBACK_GLYPH.monster, pos.x, pos.y);
      }
    });

    // Layer 6: player
    const playerTileIndex = state.entityTileByKind.player;
    const playerDrawn = drawAtlasTile(playerTileIndex, state.player.x, state.player.y);
    if (!playerDrawn) {
      drawGlyph(FALLBACK_GLYPH.player, state.player.x, state.player.y);
    }
  }

  function movePlayer(dx, dy) {
    if (state.gameOver || !state.player) {
      return;
    }

    const nx = state.player.x + dx;
    const ny = state.player.y + dy;
    if (!inBounds(nx, ny) || !isPassable(nx, ny)) {
      return;
    }

    const nextKey = cellKey(nx, ny);

    const monster = state.monsters.get(nextKey);
    if (monster) {
      const playerDamage = randomInt(10, 18);
      monster.hp -= playerDamage;
      addLog("You hit a monster for " + playerDamage + " damage.");

      if (monster.hp <= 0) {
        state.monsters.delete(nextKey);
        state.kills += 1;
        state.player.x = nx;
        state.player.y = ny;
        addLog("Monster defeated.");
      } else {
        const retaliate = randomInt(monster.atkMin, monster.atkMax);
        state.player.hp -= retaliate;
        addLog("Monster hits back for " + retaliate + " damage.");
        if (state.player.hp <= 0) {
          state.player.hp = 0;
          state.gameOver = true;
          addLog("You were defeated. Press R to regenerate.");
        }
      }

      updateStats();
      render();
      return;
    }

    state.player.x = nx;
    state.player.y = ny;

    if (state.items.has(nextKey)) {
      state.items.delete(nextKey);
      state.pickedItems += 1;
      const heal = randomInt(6, 14);
      state.player.hp = Math.min(100, state.player.hp + heal);
      addLog("Picked item, restored " + heal + " HP.");
    }

    updateStats();
    render();
  }

  function handleKeyDown(event) {
    const code = event.code;
    if (code === "KeyR") {
      regenerate();
      return;
    }

    const directions = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      KeyW: [0, -1],
      KeyS: [0, 1],
      KeyA: [-1, 0],
      KeyD: [1, 0]
    };

    const dir = directions[code];
    if (!dir) {
      return;
    }

    event.preventDefault();
    movePlayer(dir[0], dir[1]);
  }

  function regenerate() {
    const rooms = createMapData();
    createEntities(rooms);
    updateStats();
    render();
    addLog("Dungeon regenerated.");
  }

  function toggleRenderMode() {
    state.renderMode = state.renderMode === "tile" ? "glyph" : "tile";
    updateRenderModeButton();
    render();
    addLog("Render mode: " + (state.renderMode === "tile" ? "tile" : "glyph"));
  }

  function createCanvas() {
    const root = document.getElementById("displayRoot");
    if (!root) {
      throw new Error("#displayRoot not found");
    }

    root.innerHTML = "";

    const canvas = document.createElement("canvas");
    canvas.width = MAP_WIDTH * TILE_SIZE;
    canvas.height = MAP_HEIGHT * TILE_SIZE;
    canvas.style.imageRendering = "pixelated";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D context unavailable");
    }
    ctx.imageSmoothingEnabled = false;

    root.appendChild(canvas);
    state.canvas = canvas;
    state.ctx = ctx;
  }

  function buildTileIndexMap(config) {
    state.tilesByIndex.clear();
    const tiles = Array.isArray(config.tiles) ? config.tiles : [];
    tiles.forEach((tile) => {
      if (Number.isInteger(tile.index)) {
        state.tilesByIndex.set(tile.index, tile);
      }
    });

    if (state.tilesByIndex.size > 0) {
      return;
    }

    const atlas = config.atlas || {};
    const cols = atlas.columns || 10;
    const rows = atlas.rows || 10;
    const tw = atlas.tileWidth || TILE_SIZE;
    const th = atlas.tileHeight || TILE_SIZE;

    let idx = 0;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        state.tilesByIndex.set(idx, {
          index: idx,
          pixelX: gx * tw,
          pixelY: gy * th
        });
        idx += 1;
      }
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image: " + src));
      img.src = src;
    });
  }

  async function bootstrap() {
    if (typeof ROT === "undefined") {
      throw new Error("rot.js not loaded");
    }

    const configResp = await fetch("/game/assets/dungeon-tileset.config.json", { cache: "no-cache" });
    if (!configResp.ok) {
      throw new Error("Failed to load dungeon-tileset.config.json");
    }

    const config = await configResp.json();
    const atlasSrc = config && config.atlas && config.atlas.src;
    if (!atlasSrc) {
      throw new Error("atlas.src missing in config");
    }

    state.config = config;
    buildTileIndexMap(config);
    state.atlasImage = await loadImage(atlasSrc);

    createCanvas();
    exposeDataApi();
    updateRenderModeButton();
    regenerate();

    document.addEventListener("keydown", handleKeyDown);
    const regenBtn = document.getElementById("regenBtn");
    if (regenBtn) {
      regenBtn.addEventListener("click", regenerate);
    }
    const renderModeBtn = document.getElementById("renderModeBtn");
    if (renderModeBtn) {
      renderModeBtn.addEventListener("click", toggleRenderMode);
    }
  }

  bootstrap().catch((err) => {
    console.error(err);
    addLog("Init failed: " + err.message);
  });
})();
