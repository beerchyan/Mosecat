(function () {
  "use strict";

  const MAP_WIDTH = 60;
  const MAP_HEIGHT = 60;
  const TILE_SIZE = 16;
  const MAX_LOG = 80;
  const MAX_ATTEMPTS = 80;

  const DIRS = [
    { name: "N", dx: 0, dy: -1, opposite: "S" },
    { name: "E", dx: 1, dy: 0, opposite: "W" },
    { name: "S", dx: 0, dy: 1, opposite: "N" },
    { name: "W", dx: -1, dy: 0, opposite: "E" }
  ];
  const DIR_TO_RULE_KEY = {
    N: "up",
    E: "right",
    S: "down",
    W: "left"
  };

  const GLYPH = {
    floor: ".",
    wall: "W",
    door: "D"
  };

  // WFC constraints in adjacency style:
  // tiles = { tileName: { up:[...], right:[...], down:[...], left:[...], weight, passable, floorType } }
  const WFC_TILE_RULES = {
    solid: {
      weight: 2.8,
      passable: false,
      floorType: null,
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    room: {
      weight: 0.8,
      passable: true,
      floorType: "room",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    corridor_h: {
      weight: 1.8,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    corridor_v: {
      weight: 1.8,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    turn_ne: {
      weight: 1.1,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    turn_es: {
      weight: 1.1,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    turn_sw: {
      weight: 1.1,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    turn_wn: {
      weight: 1.1,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    t_n: {
      weight: 0.45,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    t_e: {
      weight: 0.45,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    t_s: {
      weight: 0.45,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    },
    t_w: {
      weight: 0.45,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    dead_n: {
      weight: 0.25,
      passable: true,
      floorType: "corridor",
      up: ["room", "corridor_v", "turn_es", "turn_sw", "t_n", "t_e", "t_w", "dead_s"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    dead_e: {
      weight: 0.25,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["room", "corridor_h", "turn_sw", "turn_wn", "t_n", "t_e", "t_s", "dead_w"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    dead_s: {
      weight: 0.25,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["room", "corridor_v", "turn_ne", "turn_wn", "t_e", "t_s", "t_w", "dead_n"],
      left: ["solid", "corridor_v", "turn_sw", "turn_wn", "t_e", "dead_n", "dead_s", "dead_w"]
    },
    dead_w: {
      weight: 0.25,
      passable: true,
      floorType: "corridor",
      up: ["solid", "corridor_h", "turn_ne", "turn_wn", "t_s", "dead_n", "dead_e", "dead_w"],
      right: ["solid", "corridor_v", "turn_ne", "turn_es", "t_w", "dead_n", "dead_e", "dead_s"],
      down: ["solid", "corridor_h", "turn_es", "turn_sw", "t_n", "dead_e", "dead_s", "dead_w"],
      left: ["room", "corridor_h", "turn_ne", "turn_es", "t_n", "t_s", "t_w", "dead_e"]
    }
  };

  const state = {
    config: null,
    atlasImage: null,
    canvas: null,
    ctx: null,
    tilesByIndex: new Map(),
    renderMode: "tile",
    floorCells: new Set(),
    roomCells: new Set(),
    wallCells: new Set(),
    doorCells: new Set(),
    doorOrientationByCell: new Map(),
    floorTileByCell: new Map(),
    wallTileByCell: new Map(),
    doorTileByCell: new Map(),
    stats: {
      attempts: 0,
      contradictions: 0,
      floor: 0,
      wall: 0,
      door: 0,
      regions: 0
    }
  };

  const WFC = buildWfcRuntime(WFC_TILE_RULES);

  function buildWfcRuntime(tileRules) {
    const tileIds = Object.keys(tileRules || {});
    if (tileIds.length === 0) {
      throw new Error("WFC tile rules are empty.");
    }
    if (tileIds.length > 31) {
      throw new Error("WFC tile count exceeds 31, cannot use bitmask.");
    }

    const tileIndexById = new Map();
    const tiles = tileIds.map((id, idx) => {
      tileIndexById.set(id, idx);
      const rule = tileRules[id] || {};
      return {
        id: id,
        weight: typeof rule.weight === "number" ? rule.weight : 1,
        passable: Boolean(rule.passable),
        floorType: rule.floorType || null
      };
    });

    const allMask = (1 << tileIds.length) - 1;
    const compatMasks = Array.from({ length: tiles.length }, () => [0, 0, 0, 0]);
    const weighted = tiles.map((tile) => tile.weight || 1);

    for (let a = 0; a < tileIds.length; a += 1) {
      const sourceId = tileIds[a];
      const sourceRule = tileRules[sourceId] || {};
      for (let d = 0; d < DIRS.length; d += 1) {
        const dir = DIRS[d];
        const ruleKey = DIR_TO_RULE_KEY[dir.name];
        const allowedIds = Array.isArray(sourceRule[ruleKey]) ? sourceRule[ruleKey] : tileIds;
        for (let i = 0; i < allowedIds.length; i += 1) {
          const neighborId = allowedIds[i];
          const neighborIndex = tileIndexById.get(neighborId);
          if (neighborIndex !== undefined) {
            compatMasks[a][d] |= (1 << neighborIndex);
          }
        }
      }
    }

    return { tiles, tileIndexById, allMask, compatMasks, weighted };
  }

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

  function bitCount(mask) {
    let n = mask >>> 0;
    let count = 0;
    while (n) {
      n &= (n - 1);
      count += 1;
    }
    return count;
  }

  function getIndicesFromMask(mask, maxBits) {
    const out = [];
    for (let i = 0; i < maxBits; i += 1) {
      if (mask & (1 << i)) {
        out.push(i);
      }
    }
    return out;
  }

  function pickWeightedIndexFromMask(mask, weights) {
    const candidates = getIndicesFromMask(mask, weights.length);
    if (candidates.length === 0) {
      return -1;
    }
    let total = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      total += Math.max(0.001, weights[candidates[i]]);
    }
    let r = Math.random() * total;
    for (let i = 0; i < candidates.length; i += 1) {
      const idx = candidates[i];
      r -= Math.max(0.001, weights[idx]);
      if (r <= 0) {
        return idx;
      }
    }
    return candidates[candidates.length - 1];
  }

  function pushLog(message) {
    const list = document.getElementById("log");
    if (!list) {
      return;
    }
    const li = document.createElement("li");
    li.textContent = message;
    list.prepend(li);
    while (list.children.length > MAX_LOG) {
      list.removeChild(list.lastElementChild);
    }
  }

  function updateStatsView() {
    const attemptsValue = document.getElementById("attemptsValue");
    const contradictionsValue = document.getElementById("contradictionsValue");
    const floorValue = document.getElementById("floorValue");
    const wallValue = document.getElementById("wallValue");
    const doorValue = document.getElementById("doorValue");
    const regionValue = document.getElementById("regionValue");

    if (attemptsValue) attemptsValue.textContent = String(state.stats.attempts);
    if (contradictionsValue) contradictionsValue.textContent = String(state.stats.contradictions);
    if (floorValue) floorValue.textContent = String(state.stats.floor);
    if (wallValue) wallValue.textContent = String(state.stats.wall);
    if (doorValue) doorValue.textContent = String(state.stats.door);
    if (regionValue) regionValue.textContent = String(state.stats.regions);
  }

  function updateRenderModeButton() {
    const btn = document.getElementById("renderModeBtn");
    if (!btn) {
      return;
    }
    btn.textContent = state.renderMode === "tile" ? "切换到符号渲染" : "切换到图片渲染";
  }

  function collectVariantIndices(variant, set) {
    if (!variant || !set) {
      return;
    }
    if (Array.isArray(variant.tileIndices)) {
      variant.tileIndices.forEach((idx) => {
        if (Number.isInteger(idx)) {
          set.add(idx);
        }
      });
    }
    if (Number.isInteger(variant.tileIndex)) {
      set.add(variant.tileIndex);
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

  function drawGlyph(ch, x, y, color) {
    if (!state.ctx) {
      return;
    }
    state.ctx.save();
    state.ctx.font = "14px 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    state.ctx.fillStyle = color || "#ffffff";
    state.ctx.textAlign = "center";
    state.ctx.textBaseline = "middle";
    state.ctx.fillText(ch, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2 + 1);
    state.ctx.restore();
  }

  function isPassable(x, y) {
    return state.floorCells.has(cellKey(x, y));
  }

  function isDoor(x, y) {
    return state.doorCells.has(cellKey(x, y));
  }

  function isWall(x, y) {
    return state.wallCells.has(cellKey(x, y));
  }

  function initMaskGrid() {
    const grid = Array.from({ length: MAP_HEIGHT }, () => Array(MAP_WIDTH).fill(WFC.allMask));
    const solidIdx = WFC.tileIndexById.get("solid");
    const roomIdx = WFC.tileIndexById.get("room");

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        if (x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1) {
          grid[y][x] = (1 << solidIdx);
        }
      }
    }

    if (Number.isInteger(roomIdx)) {
      const cx = Math.floor(MAP_WIDTH / 2);
      const cy = Math.floor(MAP_HEIGHT / 2);
      grid[cy][cx] = (1 << roomIdx);
    }

    return grid;
  }

  function propagate(grid, queue) {
    while (queue.length > 0) {
      const current = queue.pop();
      const srcMask = grid[current.y][current.x];

      for (let d = 0; d < DIRS.length; d += 1) {
        const dir = DIRS[d];
        const nx = current.x + dir.dx;
        const ny = current.y + dir.dy;
        if (!inBounds(nx, ny)) {
          continue;
        }

        const prevNeighborMask = grid[ny][nx];
        let allowedMask = 0;
        const srcTiles = getIndicesFromMask(srcMask, WFC.tiles.length);
        for (let i = 0; i < srcTiles.length; i += 1) {
          allowedMask |= WFC.compatMasks[srcTiles[i]][d];
        }
        const nextNeighborMask = prevNeighborMask & allowedMask;
        if (nextNeighborMask === 0) {
          return false;
        }
        if (nextNeighborMask !== prevNeighborMask) {
          grid[ny][nx] = nextNeighborMask;
          queue.push({ x: nx, y: ny });
        }
      }
    }

    return true;
  }

  function pickMinEntropyCell(grid) {
    let minBits = 999;
    const candidates = [];

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const bits = bitCount(grid[y][x]);
        if (bits <= 1) {
          continue;
        }
        if (bits < minBits) {
          minBits = bits;
          candidates.length = 0;
          candidates.push({ x, y });
        } else if (bits === minBits) {
          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }
    return randomChoice(candidates);
  }

  function collapseMaskGrid() {
    const grid = initMaskGrid();
    const seedQueue = [{ x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) }];
    if (!propagate(grid, seedQueue)) {
      return null;
    }

    while (true) {
      const target = pickMinEntropyCell(grid);
      if (!target) {
        return grid;
      }

      const pickedIdx = pickWeightedIndexFromMask(grid[target.y][target.x], WFC.weighted);
      if (pickedIdx < 0) {
        return null;
      }
      grid[target.y][target.x] = (1 << pickedIdx);

      const ok = propagate(grid, [target]);
      if (!ok) {
        return null;
      }
    }
  }

  function extractTileGrid(maskGrid) {
    const grid = Array.from({ length: MAP_HEIGHT }, () => Array(MAP_WIDTH).fill("solid"));
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const mask = maskGrid[y][x];
        const idx = getIndicesFromMask(mask, WFC.tiles.length)[0];
        const tile = WFC.tiles[idx] || WFC.tiles[0];
        grid[y][x] = tile.id;
      }
    }
    return grid;
  }

  function analyzePassableComponents(tileGrid) {
    const visited = new Set();
    const components = [];

    function isPassableId(id) {
      const idx = WFC.tileIndexById.get(id);
      return idx !== undefined && WFC.tiles[idx].passable;
    }

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const key = cellKey(x, y);
        if (visited.has(key) || !isPassableId(tileGrid[y][x])) {
          continue;
        }

        const queue = [{ x, y }];
        const cells = [];
        visited.add(key);

        while (queue.length > 0) {
          const cur = queue.shift();
          cells.push(cur);
          for (let i = 0; i < DIRS.length; i += 1) {
            const dir = DIRS[i];
            const nx = cur.x + dir.dx;
            const ny = cur.y + dir.dy;
            if (!inBounds(nx, ny)) {
              continue;
            }
            const nKey = cellKey(nx, ny);
            if (visited.has(nKey) || !isPassableId(tileGrid[ny][nx])) {
              continue;
            }
            visited.add(nKey);
            queue.push({ x: nx, y: ny });
          }
        }

        components.push(cells);
      }
    }

    components.sort((a, b) => b.length - a.length);
    return components;
  }

  function keepLargestRegion(tileGrid) {
    const components = analyzePassableComponents(tileGrid);
    if (components.length === 0) {
      return { tileGrid, regions: 0 };
    }

    const keep = new Set(components[0].map((c) => cellKey(c.x, c.y)));
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const key = cellKey(x, y);
        const idx = WFC.tileIndexById.get(tileGrid[y][x]);
        if (idx === undefined || !WFC.tiles[idx].passable) {
          continue;
        }
        if (!keep.has(key)) {
          tileGrid[y][x] = "solid";
        }
      }
    }

    return { tileGrid, regions: components.length };
  }

  function buildMapFromTileGrid(tileGrid, regions) {
    state.floorCells.clear();
    state.roomCells.clear();
    state.wallCells.clear();
    state.doorCells.clear();
    state.doorOrientationByCell.clear();

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const id = tileGrid[y][x];
        const idx = WFC.tileIndexById.get(id);
        const type = idx === undefined ? WFC.tiles[0] : WFC.tiles[idx];
        const key = cellKey(x, y);
        if (type.passable) {
          state.floorCells.add(key);
          if (type.floorType === "room") {
            state.roomCells.add(key);
          }
        } else {
          state.wallCells.add(key);
        }
      }
    }

    placeDoors(tileGrid);

    state.stats.floor = state.floorCells.size;
    state.stats.wall = state.wallCells.size;
    state.stats.door = state.doorCells.size;
    state.stats.regions = regions;
  }

  function placeDoors(tileGrid) {
    const strong = [];
    const weak = [];

    function isPassableAt(x, y) {
      if (!inBounds(x, y)) {
        return false;
      }
      return state.floorCells.has(cellKey(x, y));
    }

    function isRoomAt(x, y) {
      if (!inBounds(x, y)) {
        return false;
      }
      return state.roomCells.has(cellKey(x, y));
    }

    for (let y = 1; y < MAP_HEIGHT - 1; y += 1) {
      for (let x = 1; x < MAP_WIDTH - 1; x += 1) {
        const key = cellKey(x, y);
        if (!state.floorCells.has(key) || state.roomCells.has(key)) {
          continue;
        }

        const l = isPassableAt(x - 1, y);
        const r = isPassableAt(x + 1, y);
        const u = isPassableAt(x, y - 1);
        const d = isPassableAt(x, y + 1);
        const lRoom = isRoomAt(x - 1, y);
        const rRoom = isRoomAt(x + 1, y);
        const uRoom = isRoomAt(x, y - 1);
        const dRoom = isRoomAt(x, y + 1);

        if (l && r && !u && !d) {
          const hasRoomTransition = (lRoom && !rRoom) || (!lRoom && rRoom);
          (hasRoomTransition ? strong : weak).push({ key, orientation: "horizontal" });
        } else if (u && d && !l && !r) {
          const hasRoomTransition = (uRoom && !dRoom) || (!uRoom && dRoom);
          (hasRoomTransition ? strong : weak).push({ key, orientation: "vertical" });
        }
      }
    }

    shuffleInPlace(strong);
    shuffleInPlace(weak);
    const candidates = strong.concat(weak);
    const target = Math.max(4, Math.min(28, Math.floor(state.floorCells.size * 0.02)));
    const selected = [];
    const occupied = new Set();

    for (let i = 0; i < candidates.length && selected.length < target; i += 1) {
      const c = candidates[i];
      const p = parseCellKey(c.key);
      const near = [
        cellKey(p.x - 1, p.y),
        cellKey(p.x + 1, p.y),
        cellKey(p.x, p.y - 1),
        cellKey(p.x, p.y + 1)
      ];
      if (near.some((n) => occupied.has(n))) {
        continue;
      }
      selected.push(c);
      occupied.add(c.key);
      near.forEach((n) => occupied.add(n));
    }

    selected.forEach((c) => {
      state.doorCells.add(c.key);
      state.doorOrientationByCell.set(c.key, c.orientation);
    });

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const key = cellKey(x, y);
        if (state.floorCells.has(key)) {
          tileGrid[y][x] = state.roomCells.has(key) ? "room" : "corridor_h";
        }
      }
    }
  }

  function getWallTypeByNeighbors(x, y) {
    const n = isPassable(x, y - 1);
    const e = isPassable(x + 1, y);
    const s = isPassable(x, y + 1);
    const w = isPassable(x - 1, y);

    if (s && e && !n && !w) return "cornerTopLeft";
    if (s && w && !n && !e) return "cornerTopRight";
    if (n && e && !s && !w) return "cornerBottomLeft";
    if (n && w && !s && !e) return "cornerBottomRight";

    if (s && !n) return "top";
    if (n && !s) return "bottom";
    if (e && !w) return "left";
    if (w && !e) return "right";

    return null;
  }

  function buildRenderTileCache() {
    state.floorTileByCell.clear();
    state.wallTileByCell.clear();
    state.doorTileByCell.clear();

    const floorVariants = (state.config.floorVariants && state.config.floorVariants.types) || {};
    const roomWallVariants = (state.config.roomWallVariants && state.config.roomWallVariants.types) || {};
    const doorVariants = (state.config.doorVariants && state.config.doorVariants.types) || {};
    const fallbackWallMap = (state.config.wallBitmaskFallback && state.config.wallBitmaskFallback.mapping) || {};
    const forbiddenFloorIndices = new Set();
    Object.values(doorVariants).forEach((variant) => collectVariantIndices(variant, forbiddenFloorIndices));

    const defaultFloor = 0;
    const defaultWall = 0;
    const voidVariant = roomWallVariants.void || null;

    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const key = cellKey(x, y);
        if (state.floorCells.has(key)) {
          const floorVariant = state.roomCells.has(key) ? floorVariants.room : floorVariants.corridor;
          const tile = getVariantTileIndexExcluding(
            floorVariant,
            defaultFloor,
            isDoor(x, y) ? null : forbiddenFloorIndices
          );
          if (Number.isInteger(tile)) {
            state.floorTileByCell.set(key, tile);
          }
        }

        if (state.wallCells.has(key)) {
          const wallType = getWallTypeByNeighbors(x, y);
          let wallTile = null;
          if (wallType && roomWallVariants[wallType]) {
            wallTile = getVariantTileIndex(roomWallVariants[wallType], defaultWall);
          } else if (voidVariant) {
            wallTile = getVariantTileIndex(voidVariant, defaultWall);
          } else {
            const bits =
              (isPassable(x, y - 1) ? "1" : "0") +
              (isPassable(x + 1, y) ? "1" : "0") +
              (isPassable(x, y + 1) ? "1" : "0") +
              (isPassable(x - 1, y) ? "1" : "0");
            wallTile = getVariantTileIndex(fallbackWallMap[bits], defaultWall);
          }
          if (Number.isInteger(wallTile)) {
            state.wallTileByCell.set(key, wallTile);
          }
        }

        if (state.doorCells.has(key)) {
          const ori = state.doorOrientationByCell.get(key) || "horizontal";
          let variant = null;
          if (ori === "horizontal") {
            variant = doorVariants.horizontal;
          } else {
            const leftWall = state.wallCells.has(cellKey(x - 1, y));
            const rightWall = state.wallCells.has(cellKey(x + 1, y));
            if (leftWall && !rightWall) {
              variant = doorVariants.verticalNearLeftWall || doorVariants.verticalLeft || doorVariants.vertical;
            } else if (rightWall && !leftWall) {
              variant = doorVariants.verticalNearRightWall || doorVariants.verticalRight || doorVariants.vertical;
            } else {
              variant = doorVariants.vertical;
            }
          }

          const doorTile = getVariantTileIndex(variant, null);
          if (Number.isInteger(doorTile)) {
            state.doorTileByCell.set(key, doorTile);
          }
        }
      }
    }
  }

  function render() {
    const ctx = state.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);
    ctx.fillStyle = "#0d1a32";
    ctx.fillRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    if (state.renderMode === "glyph") {
      state.floorCells.forEach((key) => {
        const p = parseCellKey(key);
        drawGlyph(GLYPH.floor, p.x, p.y, "#8da2c6");
      });
      state.wallCells.forEach((key) => {
        const p = parseCellKey(key);
        drawGlyph(GLYPH.wall, p.x, p.y);
      });
      state.doorCells.forEach((key) => {
        const p = parseCellKey(key);
        drawGlyph(GLYPH.door, p.x, p.y);
      });
      return;
    }

    state.floorCells.forEach((key) => {
      const p = parseCellKey(key);
      const tileIndex = state.floorTileByCell.get(key);
      const drawn = drawAtlasTile(tileIndex, p.x, p.y);
      if (!drawn) {
        ctx.fillStyle = "#1f2f4e";
        ctx.fillRect(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    });

    state.wallCells.forEach((key) => {
      const p = parseCellKey(key);
      const tileIndex = state.wallTileByCell.get(key);
      const drawn = drawAtlasTile(tileIndex, p.x, p.y);
      if (!drawn) {
        drawGlyph(GLYPH.wall, p.x, p.y);
      }
    });

    state.doorCells.forEach((key) => {
      const p = parseCellKey(key);
      const tileIndex = state.doorTileByCell.get(key);
      const drawn = drawAtlasTile(tileIndex, p.x, p.y);
      if (!drawn) {
        drawGlyph(GLYPH.door, p.x, p.y);
      }
    });
  }

  function runWfcGeneration() {
    let contradictions = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const maskGrid = collapseMaskGrid();
      if (!maskGrid) {
        contradictions += 1;
        continue;
      }

      const tileGrid = extractTileGrid(maskGrid);
      const kept = keepLargestRegion(tileGrid);
      buildMapFromTileGrid(kept.tileGrid, kept.regions);
      buildRenderTileCache();
      state.stats.attempts = attempt;
      state.stats.contradictions = contradictions;
      return true;
    }

    state.stats.attempts = MAX_ATTEMPTS;
    state.stats.contradictions = MAX_ATTEMPTS;
    state.floorCells.clear();
    state.wallCells.clear();
    state.doorCells.clear();
    state.floorTileByCell.clear();
    state.wallTileByCell.clear();
    state.doorTileByCell.clear();
    return false;
  }

  function regenerate() {
    const ok = runWfcGeneration();
    updateStatsView();
    render();
    if (ok) {
      pushLog("WFC generation completed.");
    } else {
      pushLog("WFC failed after max attempts.");
    }
  }

  function toggleRenderMode() {
    state.renderMode = state.renderMode === "tile" ? "glyph" : "tile";
    updateRenderModeButton();
    render();
    pushLog("Render mode: " + state.renderMode);
  }

  function handleKeyDown(event) {
    if (event.code === "KeyR") {
      regenerate();
    }
  }

  function createCanvas() {
    const root = document.getElementById("displayRoot");
    if (!root) throw new Error("#displayRoot not found");
    root.innerHTML = "";

    const canvas = document.createElement("canvas");
    canvas.width = MAP_WIDTH * TILE_SIZE;
    canvas.height = MAP_HEIGHT * TILE_SIZE;
    canvas.style.imageRendering = "pixelated";
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
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

  function exposeApi() {
    window.localDungeonWFCData = {
      getStats: function () {
        return JSON.parse(JSON.stringify(state.stats));
      },
      getMapSummary: function () {
        return {
          floor: state.floorCells.size,
          wall: state.wallCells.size,
          door: state.doorCells.size
        };
      }
    };
  }

  async function bootstrap() {
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
    updateRenderModeButton();
    exposeApi();
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
    pushLog("Init failed: " + err.message);
  });
})();
