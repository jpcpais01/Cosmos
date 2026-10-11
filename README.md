# Cosmos

Cosmos lets you fly a small white starship through a real-scale Solar System in your browser. It is an installable PWA built with Vite, TypeScript and Three.js.

- **Real scale.** Planets, moons and the Sun have their true sizes, and distances are in kilometres. Positions follow live ephemerides (astronomy-engine) for the current date. You can speed time up, slow it down or pause it.
- **Real surfaces.** Every planet and the main moons use freely licensed global maps. Earth gets day, night lights, clouds, an ocean glint and a normal map. Maps stream in at higher resolution as you get closer.
- **Real sky.** 112,699 Hipparcos stars sit at their true positions, with true brightness and colour. The ESO Milky Way panorama is placed in the galactic frame behind them.
- **Physically based look.**
  - Ray-traced planet impostors with atmospheric scattering, eclipses and Saturn's ring shadows.
  - HDR rendering with bloom, eye adaptation, AgX tone mapping and a lens flare.
- **Warp drive.**
  - Pick a body or any coordinates on the Solar System map, choose 1c, 3c, 10c, 50c or 100c, and engage.
  - The ship aligns, spools up, flashes into a warp tunnel and drops out near the target.
  - During warp the sky shows relativistic aberration and Doppler shift.
- **Three views.** A first-person cockpit with baked ambient occlusion and live instrument displays, plus a near and a far chase camera.
- **Five saved locations.** Low Earth Orbit; Over Europe with Jupiter setting; Earthrise over the Moon; Io with Jupiter rising; and above Saturn's rings. You can also save your own.

## Controls

| Key | Action |
|---|---|
| W / S | Throttle up / down (logarithmic, 10 m/s to 15,000 km/s) |
| A / D, ← → | Yaw |
| ↑ ↓ | Pitch |
| Q / E | Roll |
| Shift | Boost |
| X | Brake |
| Right-click | Mouse flight (pointer lock); Esc releases it |
| Left-drag | Look around in the cockpit, or orbit the camera outside |
| V | Switch view: cockpit, chase, far chase |
| M | Solar System map |
| 1–5 | Warp factor 1c, 3c, 10c, 50c, 100c |
| J | Engage warp, or drop out of warp |
| L | Saved locations |
| T | Toggle labels |
| G | Toggle the FPS counter |
| , / . / P | Slower time, faster time, pause |
| F | Fullscreen |
| H | Help |

On touch screens the game shows a stick and throttle, and you can drag to look around.

URL options:
- `?loc=earth-orbit` (or `europe-jupiter`, `earthrise`, `io-jupiter`, `saturn-rings`) opens a saved location.
- `?view=chase` starts in a chase view.
- `?autostart` skips the launch screen.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds the static site into dist/
npm run preview    # serves dist/ locally
```

Node 20 or newer is needed.

## Deploying to Vercel

Import the repository in Vercel. It detects Vite, runs `npm run build` and serves `dist/`, so no settings need changing. `vercel.json` only adds long-lived cache headers for the textures, models and hashed assets.

The service worker precaches about 3 MB: the app shell, the ship, the star catalogue and the small Milky Way map. Planet maps are cached the first time they load, so places you have visited work offline.

## Performance

- Quality presets (Low, Medium, High, Ultra in Settings) set the render resolution, MSAA, the largest texture tier and the shadow map size. The default is picked from the device.
- Dynamic resolution lowers the render scale when the frame rate drops. Add `?nodyn` to turn it off.
- Planets are single-quad ray-traced impostors rather than dense meshes.
- The star field is one instanced draw.
- Textures stream in by distance, from 1K up to 8K.

## Project layout

- `src/sim`: ephemerides, body data and reference frames.
- `src/render`: the universe, planet, sky, environment-map and post-processing shaders.
- `src/ship`: the ship model, flight model and camera rig.
- `src/game`: warp, input and saved locations.
- `src/ui`: HUD, map and cockpit displays.
- `src/audio`: the synthesised sound.
- `tools/`: Python scripts that build the textures, star catalogue, icons and the ship (Blender).

## Credits

Planet and moon maps come from Solar System Scope (CC BY 4.0), the Celestia project, USGS/NASA, Fourmilab and others. The Milky Way panorama is © ESO/S. Brunier (CC BY 4.0). The star catalogue is Hipparcos via d3-celestial. Full per-file sources and licences are in [CREDITS.md](CREDITS.md).
