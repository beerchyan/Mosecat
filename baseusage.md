# rot.js Manual Base Usage

Source:
- https://ondras.github.io/rot.js/manual
- https://github.com/ondras/rot.js/tree/master/manual/pages

Scope:
- This file records operation methods shown in all chapters under the manual pages menu.
- It focuses on practical constructor/method usage and key options used in examples.

## 1) Introduction
- The examples use `SHOW(...)`, which is only a helper in manual demos and is not part of rot.js.

## 2) Utilities (`util`, `format`)

### `ROT.Util`
- `ROT.Util.capitalize(str)`
- `ROT.Util.mod(value, n)`
- `ROT.Util.clamp(value, min = 0, max = 1)`
- `ROT.Util.format(template, ...args)`

### `ROT.Util.format` extension points
- `ROT.Util.format.map` for custom format specifiers.
- Default map includes `{ s: "toString" }`.
- Add custom mapping, example: `ROT.Util.format.map.f = "foo"`.
- Supports uppercase specifier for capitalized output (example `%The`).
- Supports arguments in specifier: `%{adjective,black}`.

## 3) Keyboard handling (`keyboard`)
- Use browser events: `keydown`, `keypress`, `keyup`.
- Compare `e.keyCode` with `ROT.KEYS.VK_*`.
- Read printable char via `e.charCode` and `String.fromCharCode(...)`.
- `ROT.KEYS` is the constant table namespace.

## 4) RNG (`rng`)

### Core methods
- `ROT.RNG.getUniform()`
- `ROT.RNG.getNormal(mean, stddev)`
- `ROT.RNG.getPercentage()`
- `ROT.RNG.getItem(array)`
- `ROT.RNG.shuffle(array)`
- `ROT.RNG.getWeightedValue(weightsObject)`

### State and reproducibility
- `ROT.RNG.getState()`
- `ROT.RNG.setState(state)`
- `ROT.RNG.getSeed()`
- `ROT.RNG.setSeed(seed)`
- `ROT.RNG.clone()`

## 5) Display (`display`, `tiles`, `hex/about`, `performance`)

### ASCII/rect/hex display
- Constructor: `new ROT.Display(options)`
- Container: `display.getContainer()`
- Runtime config: `display.setOptions(options)`
- Draw one cell: `display.draw(x, y, ch, fg?, bg?)`
- Draw text: `display.drawText(x, y, text, maxWidth?)`
- Partial overwrite: `display.drawOver(x, y, ch?, fg?, bg?)`
- Debug callback: `display.DEBUG(x, y, value)`

### Common display options
- `width`, `height`
- `fontSize`, `fontFamily`, `fontStyle`
- `fg`, `bg`
- `spacing`
- `layout`: `"rect" | "hex" | "tile" | "tile-gl"`
- `forceSquareRatio: true`
- `transpose: true` (hex flat-top style; swaps x/y behavior)

### Color markup in `drawText`
- Foreground: `%c{color}`
- Background: `%b{color}`
- Reset to default with empty braces.

### Tile rendering (`layout: "tile"`)
- Required options:
- `tileWidth`, `tileHeight`, `tileSet`, `tileMap`
- Draw stacked tiles in one cell: `display.draw(x, y, ["#", "@"])`
- Enable colorization: `tileColorize: true`
- Colorized stack uses array args for fg/bg.

### WebGL tile backend (`layout: "tile-gl"`)
- Feature check: `ROT.Display.TileGL.isSupported()`

### Performance tip
- Rect glyph cache: `ROT.Display.Rect.cache = true`

## 6) Map generation (`map`, `map/maze`, `map/cellular`, `map/dungeon`)

### Shared map API
- Constructor pattern: `new ROT.Map.*(width, height, options?)`
- Generate via callback: `map.create((x, y, value) => { ... })`

### Arena
- `new ROT.Map.Arena(w, h)`

### Maze generators
- `new ROT.Map.DividedMaze(w, h)`
- `new ROT.Map.IceyMaze(w, h, regularity)`
- `new ROT.Map.EllerMaze(w, h)`

### Cellular automata
- `new ROT.Map.Cellular(w, h, { born, survive, topology })`
- `map.set(x, y, value)`
- `map.randomize(probability)`
- `map.create(callback?)` (can iterate generations)
- `map.connect(callback, valueToConnect = 0, connectionCallback?)`
- `topology` supports `4 | 6 | 8`

### Dungeon generators
- `new ROT.Map.Digger(w, h, { roomWidth, roomHeight, corridorLength, dugPercentage, timeLimit })`
- `new ROT.Map.Uniform(w, h, { roomWidth, roomHeight, roomDugPercentage, timeLimit })`
- `new ROT.Map.Rogue(w, h)`
- After creation:
- `map.getRooms()`
- `map.getCorridors()`

### Room object methods (from dungeon examples)
- `room.getLeft()`
- `room.getTop()`
- `room.getRight()`
- `room.getBottom()`
- `room.getDoors(callback)`

## 7) FOV (`fov`, `hex/about`)

### Algorithms
- `new ROT.FOV.PreciseShadowcasting(lightPassesCallback, options?)`
- `new ROT.FOV.RecursiveShadowcasting(lightPassesCallback, options?)`

### Compute methods
- `fov.compute(x, y, radius, outputCallback)`
- `fov.compute180(x, y, radius, dir, outputCallback)`
- `fov.compute90(x, y, radius, dir, outputCallback)`

### Callback contract
- Input callback returns `true/false` for light passability.
- Output callback args: `(x, y, r, visibility)`.
- Hex usage: pass `topology: 6` where applicable.

## 8) Color (`color`)

### Parsing and serialization
- `ROT.Color.fromString(colorStr)`
- `ROT.Color.toRGB([r,g,b])`
- `ROT.Color.toHex([r,g,b])`

### Color space conversion
- `ROT.Color.rgb2hsl([r,g,b])`
- `ROT.Color.hsl2rgb([h,s,l])`

### Mix/compose
- `ROT.Color.add(...colors)`
- `ROT.Color.add_(base, ...colors)` (in-place)
- `ROT.Color.multiply(...colors)`
- `ROT.Color.multiply_(base, ...colors)` (in-place)

### Interpolation and variation
- `ROT.Color.interpolate(c1, c2, factor = 0.5)`
- `ROT.Color.interpolateHSL(c1, c2, factor = 0.5)`
- `ROT.Color.randomize(baseColor, stddevArray)`

## 9) Lighting (`lighting`)
- Constructor:
- `new ROT.Lighting(reflectivityCallback, { range, passes, emissionThreshold })`
- Attach FOV:
- `lighting.setFOV(fov)`
- Set light source:
- `lighting.setLight(x, y, color)`
- Compute light field:
- `lighting.compute(lightingCallback)`

## 10) Pathfinding (`path`, `hex/about`)

### Algorithms
- `new ROT.Path.Dijkstra(targetX, targetY, passableCallback, { topology })`
- `new ROT.Path.AStar(targetX, targetY, passableCallback, { topology })`

### Compute path
- `pathfinder.compute(sourceX, sourceY, outputCallback)`

### Notes
- `topology` supports `4 | 6 | 8`.
- Reusing the same pathfinder for multiple `compute(...)` calls is recommended when passability data is unchanged.

## 11) Noise (`noise`)
- `new ROT.Noise.Simplex()`
- `noise.get(x, y)`

## 12) Timing and scheduling (`timing`, `timing/eventqueue`, `timing/scheduler`, `timing/engine`)

### Event queue
- `new ROT.EventQueue()`
- `queue.add(item, time)`
- `queue.remove(item)`
- `queue.get()`
- `queue.getTime()`

### Scheduler common API
- `new ROT.Scheduler.*()`
- `scheduler.add(item, repeat, initialDelay?)`
- `scheduler.remove(item)`
- `scheduler.clear()`
- `scheduler.getTime()`
- `scheduler.next()`

### Scheduler implementations
- `ROT.Scheduler.Simple`
- `ROT.Scheduler.Speed` (actor must implement `getSpeed()`)
- `ROT.Scheduler.Action` with `scheduler.setDuration(duration)` after `next()`

### Engine
- `new ROT.Engine(scheduler)`
- `engine.start()`
- `engine.lock()`
- `engine.unlock()`
- Actor API: `actor.act()`
- If `act()` returns a thenable/promise, engine waits for resolution.

## 13) String generator (`stringgenerator`)
- Constructor:
- `new ROT.StringGenerator({ words, order, prior })`
- Train model:
- `sg.observe(sample)`
- Generate text:
- `sg.generate()`

## 14) Hex indexing (`hex/indexing`)
- Manual describes four indexing models:
- Non-orthogonal
- Odd shift
- Double width (used by rot.js)
- Cube projection
- It provides distance formulas, neighbor offsets, and straight-line coordinate rules for each model.

## 15) Chapters with no additional API methods
- `intro`, `timing`, `changelog` are mainly conceptual/index/history pages.
