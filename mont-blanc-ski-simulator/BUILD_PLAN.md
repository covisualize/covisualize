# Mont Blanc Ski Simulator — Build Plan & Architecture

A zero-download, single-page Three.js first-person ski simulator set on real Chamonix / Mont Blanc elevation data (`45.83°N, 6.86°E`), built 100% in code with no external 3D models.

## Implemented Steps

### Step 1 — Real Mont Blanc / Chamonix Mountain
- **Data source:** AWS Open Data Terrain Tiles (Mapzen Terrarium PNG, Zoom 13, ~13 m ground sampling distance) covering `45.826°N–45.940°N`, `6.805°E–6.925°E` (Mont Blanc `4,786 m` DEM / `4,808 m` summit, Dôme du Goûter, Aiguille du Midi, Glacier des Bossons, and Chamonix Valley `978 m`).
- **Compact asset:** `scripts/fetch_mont_blanc_dem.py` stitches the tiles and exports `data/mont_blanc_dem.png` (`380 KB`, 513×513 lossless RGB PNG packing 16-bit elevation into R+G and the real Glacier des Bossons ice corridor mask into B) alongside `data/mont_blanc_meta.json`.
- **Adaptive terrain mesh (`src/terrain.js`):** Full-massif `256×256` base mesh paired with a snapping `104×104` high-resolution near-player patch (`~2.0 m` vertex spacing) using bicubic DEM interpolation and subtle snow micro-relief.

### Step 2 — Shaders & Alpine Atmosphere
- **Snow, rock & glacier shader (`src/terrain.js`):** Custom GLSL `ShaderMaterial` with slope-based snow-to-granite rock blending, view-dependent micro-crystal snow sparkle, soft cobalt-blue Alpine shadows, luminous cyan Glacier des Bossons ice with crevasse striations, real PCF shadow-map sampling for trees/boulders, analytical projected first-person skier shadow on the snow, and Rayleigh/Mie atmospheric valley haze.
- **Sky, sun & clouds (`src/sky.js`):** Custom GLSL atmospheric sky dome with sun disc, Mie scattering halo, procedural drifting FBM clouds, and continuous Time-of-Day presets from Dawn and Morning to **Pink Sunset** alpenglow and Alpine Dusk.

### Step 3 — First-Person Skier & Physics
- **Procedural rig (`src/skier.js`):** Camera at head height (dropping smoothly into an aero tuck), twin procedural freeride skis with upturned tips and bindings, left/right ski poles with baskets, and dynamic carving snow spray particles.
- **Physics & controls:** Gravity along the true Mont Blanc slope gradient, edge-angle carving turns, slicker cyan glacier ice handling, aerodynamic tuck (`↑`/`W`), edge brake (`↓`/`S`), crest jumps (`Space`), and high-speed crash detection against rocks and pine trees.

### Step 4 — Carved Snow Tracks
- **Dual-cascade track maps (`src/tracks.js`):**
  1. Rolling `512×512` high-res near window (`~21 cm/texel`) capturing twin ski grooves and displaced carving snow berms with normal perturbation in the snow shader.
  2. Persistent `1024×1024` full-mountain corridor map preserving your entire run's S-turns and avalanche scour trails permanently.

### Step 5 — Procedural Pine Trees & Granite Rocks
- **Instanced scenery (`src/environment.js`):** Snow-dusted multi-tier cone pine trees (~1,650 instances in 1 draw call) placed automatically below treeline (`<2,260 m`) on skiable slopes (`<33°`), plus ~340 snow-capped granite boulders (1 draw call), backcountry guide gates, a Chamonix Valley finish arch, and an O(1) spatial hash collider.

### Step 6 — Live Dynamic Avalanches
- **Slab fracture & terrain-following flow (`src/avalanche.js`):** Triggers automatically when carving across steep high-alpine faces/fracture zones (or manually via `V` / HUD button). Simulates 2,400 billowing powder particles and 120 tumbling ice/snow chunks sliding downhill along the real DEM slope gradient, stamping scour trails, roaring with proximity-scaled rumble, and capable of overtaking the skier.

### Step 7 — Polish, Audio & Mobile
- **Procedural Web Audio (`src/audio.js`):** Airspeed wind rush, carving snow/glacier ice scrape, avalanche fracture crack and sub-bass rumble, jumps, landings, crashes, and finish chime — zero audio files downloaded.
- **UI & controls (`index.html`, `styles.css`, `src/main.js`):** Speed-blur radial streaks, live Time-of-Day slider & presets, start screen, run timer, `localStorage` best time, FPS monitor, phone tilt-to-steer (`DeviceOrientationEvent`), and on-screen mobile touch controls.

### Step 8 — Local Run & GitHub Pages
Run locally with any static server:
```bash
python3 -m http.server 8080
# Open http://localhost:8080/mont-blanc-ski-simulator/
```

To regenerate the real Mont Blanc heightmap from AWS Terrarium tiles:
```bash
python3 scripts/fetch_mont_blanc_dem.py
```

On GitHub Pages (root of `covisualize/covisualize` on `main`), the game serves directly at:
`https://covisualize.github.io/covisualize/mont-blanc-ski-simulator/`
