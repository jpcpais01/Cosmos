# Credits and licences

Cosmos's own code is MIT licensed (see `package.json`). The data and images it ships with come from the sources below, and each keeps its own licence. Every file under `public/textures/` was converted to WebP and resized by `tools/build_textures.py`. Some files were also recentred, desaturated or had their stars removed, as noted below. Maps 4096 px wide or larger were then cut into 512 px tiles by `tools/build_tiles.py`.

## Planet, Sun and Moon maps

All of these are **CC BY 4.0, © Solar System Scope / INOVE**, based on NASA data (https://www.solarsystemscope.com/textures/).

| Body | Maps |
|---|---|
| Sun | colour |
| Mercury | colour |
| Venus | atmosphere |
| Earth | day, night lights, clouds, ocean specular, normal |
| Moon | colour |
| Mars | colour |
| Jupiter | colour |
| Saturn | colour, ring transparency strip |
| Uranus | colour |
| Neptune | colour |

## Moons and dwarf planets

| Body | Source | Licence | Credit |
|---|---|---|---|
| Io | CelestiaProject/CelestiaContent `textures/hires/io.png` | CC BY 4.0 | ItzImcool, AstroChara; NASA/JPL-Caltech/ASI/USGS; NASA/JPL/SwRI/MSSS/Gerald Eichstädt/Jason Perry/John Rogers |
| Europa | abhi-singhs/solar-atlas, from USGS Voyager/Galileo SSI global mosaic | Public domain (processing MIT) | NASA/JPL/Caltech/USGS; processing by Abhi Singh |
| Ganymede | CelestiaContent `textures/hires/ganymede.jpg` | CC BY 3.0 | Askaniy Anpilogov; NASA/JPL-Caltech/ASI/USGS; NASA/JPL-Caltech/Björn Jónsson; NASA/JPL-Caltech/SwRI/MSSS/Brian Swift |
| Callisto | solar-atlas, from USGS Voyager/Galileo SSI global mosaic | Public domain (processing MIT) | NASA/JPL/Caltech/USGS; Abhi Singh |
| Phobos | CelestiaContent `textures/hires/phobos.jpg` | CC BY 3.0 | Askaniy Anpilogov; P. Stooke, Stooke Small Bodies Maps V3.0, NASA PDS |
| Deimos | CelestiaContent `textures/hires/deimos.jpg` | CC0 1.0 | P. Stooke, Stooke Small Bodies Maps V3.0, NASA PDS |
| Mimas, Dione | Fourmilab/orbits, from Paul Schenk's LPI Cassini colour maps (PIA18437, PIA18434); recentred and desaturated | Public domain source; Fourmilab repo CC BY-SA 4.0 | NASA/JPL-Caltech/Space Science Institute/LPI (P. Schenk); Fourmilab (John Walker) |
| Enceladus, Tethys, Rhea, Iapetus | solar-atlas, from USGS Cassini global mosaics | Public domain (processing MIT) | NASA/JPL/Caltech/Space Science Institute/USGS; Abhi Singh |
| Titan | CelestiaContent `textures/hires/titan.png` (surface) | CC BY 3.0 | Askaniy Anpilogov, Pedro Garcia, AstroChara; Seignovert et al. (2019); Karkoschka et al. (2016); NASA/JPL-Caltech/ASI/USGS; Caltech-JPL/Univ. of Arizona/LPG-Univ. of Nantes-CNRS |
| Miranda, Ariel, Umbriel, Titania, Oberon | CelestiaContent `textures/hires` and `textures/medres`, rotated 180° to the IAU pole | CC BY-SA 4.0 | ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk; Phil Stooke (Umbriel) |
| Triton | CelestiaContent `textures/hires/triton.jpg` | CC BY 3.0 | Askaniy Anpilogov; NASA/JPL-Caltech/ASI/USGS |
| Pluto | solar-atlas, from NASA's New Horizons global colour mosaic | Public domain (processing MIT) | NASA/Johns Hopkins University APL/Southwest Research Institute; Abhi Singh |
| Charon | solar-atlas, from NASA PIA19866 | Public domain (processing MIT) | NASA/JHUAPL/SwRI; Abhi Singh |

## Normal maps

| Map | Source | Licence | Credit |
|---|---|---|---|
| Moon normal | tsigave/transfer-window, from NASA SVS CGI Moon Kit (LRO/LOLA) | Public domain source; processing Apache-2.0 | NASA/Goddard SVS, LRO/LOLA team; tsigave/transfer-window |
| Mars normal | tsigave/transfer-window, from USGS MGS MOLA global DEM | Public domain source; processing Apache-2.0 | NASA MGS MOLA team / USGS Astrogeology; tsigave/transfer-window |

## Sky

- **Milky Way** (`public/textures/sky/galaxy_*.webp`): built by `tools/build_sky.py` from two maps. Its licence is CC BY-SA 3.0 IGO, because it adapts Gaia's map.
  - Structure: "Gaia's sky in colour" from Gaia EDR3, **CC BY-SA 3.0 IGO, ESA/Gaia/DPAC**. The plate carrée copy used is `MW_edgeon_edr3_unannotate.jpg` from the mw_plot package (https://github.com/henrysky/milkyway_plot). It was denoised, its point stars were flattened and its levels were mapped onto ESO's brightness.
  - Colour, broad brightness, and objects Gaia does not show (Andromeda, Triangulum, bright nebulae): ESO eso0932a, **CC BY 4.0, © ESO/S. Brunier** (with Frédéric Tapissier). Its point stars were removed by `tools/build_textures.py`, it was rotated 3.8° onto the true galactic frame, and its seam at longitude 180° was closed.
- **Stars**: 112,699 stars to magnitude 10.5 from the Hipparcos-based catalogue in d3-celestial (https://github.com/ofrohn/d3-celestial, BSD-3-Clause, © Olaf Frohn). That catalogue derives from ESA's Hipparcos mission. They are packed into `public/data/stars.bin` by `tools/build_stars.py`.

## Software

- three.js, MIT, © three.js authors
- astronomy-engine, MIT, © Don Cross. It provides the planet and moon ephemerides.
- vite-plugin-pwa / Workbox, MIT
- Rajdhani font, SIL Open Font License 1.1, © Indian Type Foundry. It is loaded from Google Fonts.

## Ship

The ship, cockpit, pilot and baked ambient-occlusion maps are original work for this project. They were generated procedurally in Blender by `tools/ship/build_ship.py` (the pilot by `tools/ship/pilot.py`) and are covered by the project's MIT licence.
