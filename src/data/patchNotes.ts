// Patch notes shown on the title screen, newest first. Add an entry at the top for each update.
// Don't number entries: the version shown is worked out from the list order (the oldest is 0.1),
// so parallel updates can't claim the same number.

export interface PatchNote {
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
}

export const PATCH_NOTES: PatchNote[] = [
  {
    date: '2026-10-11',
    title: 'Warp gates: jump to another star',
    notes: [
      'Every star system now has a warp gate at its edge, the only way to another star. The Solar System\'s is 32 AU out, beyond Neptune, facing Kepler-385 in Cygnus. Kepler-385\'s is 1 AU from its star, on the side that faces home.',
      'Pick Warp gate on the map (M) and warp there, or use the new gate locations in the Saved locations panel (L). Within 60 km the gate\'s panel opens: choose a star and press Enter or tap Jump.',
      'The ship lines up with the gate, its rings spin up and the portal charges, then you fly through into a hyperspace tunnel of violet plasma, gold filaments, rings of light and lightning, and come out of the destination\'s gate 4,945 light years away. It has its own sounds too.',
      'The sky seen from Kepler-385 now has about as many faint stars as ours, so it looks less crowded.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Kepler-385: the first star beyond the Sun',
    notes: [
      'Kepler-385, a real Sun-like star 4,940 light years away in Cygnus, is now in the game with its seven planets, at the sizes, orbits and positions astronomers have measured. Each planet is where its transit times put it today.',
      'Go there from the Saved locations panel (L): a magma ocean on KOI-2433.08, a lake of fire on KOI-2433.06, the deep-blue Kepler-385 b, banded Kepler-385 d, and a view of all seven worlds at once.',
      'Nobody has pictures of these planets, so their surfaces are made from what is known: the two small rocky worlds are close enough to the star for their rock to melt and glow, and the five sub-Neptunes are coloured by how hot they are.',
      'Its sky is different too. The Milky Way sits where it should from there, and the bright stars are a new, realistic set, because none of the stars we know are near enough to see.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'See-through warp',
    notes: [
      'The warp is see-through now. The white glare when it engages is gone, and so is the milky haze from the bent starlight. Space still ripples and bends the same way.',
      'Stronger chromatic aberration, with sudden glitchy spikes that hit with each jolt of the shake.',
      'The warp shake is stronger.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'No work wasted behind the dashboard',
    notes: [
      'From the cockpit, the sky and the planets are no longer drawn in the part of the screen the dashboard, the nose and the canopy frame cover. That is about a quarter of the view in a normal seat, and it skips the most expensive pixels when a planet fills the lower half of the screen.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Lighter on the graphics card',
    notes: [
      'The game no longer rewrites the whole frame once more every time the Sun is on screen or the warp drive is on. The ship\'s outline now comes for free from the depth it already draws.',
      'Ship reflections are rebuilt only when what they reflect has actually changed, instead of about three times a second. That was a small stutter you could feel on slower graphics.',
      'The glow (bloom) uses a format half the size, so every glow pass moves half the data.',
      'Removed an unused full-screen buffer, which frees some video memory.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'A cleaner, shakier warp',
    notes: [
      'The warp tunnel is silver and white now. Its only colour is the red and blue fringing of chromatic aberration, which grows with speed.',
      'The view shakes during warp with a smooth sway, bursts of rumble and the odd soft jolt, stronger at higher warp factors.',
      'The warp costs the graphics card no more than before.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Lighter on the processor',
    notes: [
      'The HUD only rewrites text that changed, and the scanner no longer forces the page to re-measure its layout 30 times a second.',
      'The cockpit screens refresh less often when you are outside the ship, and their grid is drawn once instead of every refresh.',
      'Planet positions are not recalculated while time is paused.',
      'Fixed the warp ETA and the "too close" check, which used the wrong distance before you engaged.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Patch notes in a popup',
    notes: ['The patch notes now sit behind a small What\'s new button in the top right of the title screen. Close them with the X, a tap outside or Escape.'],
  },
  {
    date: '2026-10-11',
    title: 'Landscape from the first touch',
    notes: [
      'On phones and tablets, the first touch anywhere (even on the loading or title screen) now switches to full screen and turns the game sideways, where the browser allows it (Android Chrome).',
      'If you leave the app and come back, the next touch does it again. On iPhone, Safari can\'t lock the screen, so the rotate prompt still asks you to turn the phone.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Ten new famous views',
    notes: [
      'The Saved locations panel (L or the pin button) has ten more places to jump to, each at a moment picked for its light: the Moon\'s shadow on Earth during the 2027 total eclipse, Io\'s shadow on Jupiter, Saturn hiding the Sun, a crescent Venus, dawn on Mercury, Phobos over Mars, Titan before Saturn, Uranus from Miranda, Pluto and Charon, and a half Moon beside a half Earth.',
      'Some of them switch to the chase camera so the ship is in the shot.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'A cleaner phone layout',
    notes: [
      'On phones the flight controls now take centre stage: a tall throttle on the right edge with BOOST, BRAKE and REV beside it, and the stick and roll buttons on the left.',
      'The scanner moved to the top left, with your location and the date in small type beside it.',
      'The warp drive is now one slim strip at the bottom: the destination, the warp factor and ENGAGE.',
      'Smaller toolbar buttons and speed readout. The time controls are in the ••• menu, and the date shows the time rate whenever time isn\'t running normally.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Cleaner wrists',
    notes: ['The bulky cuffs on the pilot\'s gloves are gone. Each glove now runs straight into the sleeve, so the wrists no longer flicker or clip as the hands move the stick and throttle.'],
  },
  {
    date: '2026-10-11',
    title: 'Clouds are back on Earth',
    notes: [
      'Earth has its clouds again, now as part of the planet\'s 8K surface picture: they stay put over the ground instead of drifting as a separate layer, and cast no extra shadows.',
      'The sea no longer glints through clouds, and city lights are dimmed under them at night.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Save your own locations',
    notes: [
      'Press B, or use Save here in the Saved locations panel (L or the pin button), to bookmark where you are, which way you face and the date and time.',
      'Your locations are listed first, named after the nearest planet or moon unless you give a name. Rename them with the pencil or delete them with the cross.',
      'Untick "Jump to the time it was saved" to go back to a spot but stay at the current time.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'A subtler night sky',
    notes: [
      'The Milky Way and faint stars are dimmer, closer to how faint they really look.',
      'Like a real eye or camera, the stars fade when the sunlit Earth, the Sun or the lit hull are in view.',
      'Turn towards empty space and they come back.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Fixed gloves',
    notes: ['The pilot\'s gloves no longer have see-through fingertips and palms, and the fingers wrap round the stick and throttle instead of cutting into them.'],
  },
  {
    date: '2026-10-11',
    title: 'Smooth turn before warp',
    notes: ['When the ship turns to face a warp target it now eases into the turn, swings round at a steady rate and settles gently on the target, just like turning with the mouse. The pilot moves the stick along with it.'],
  },
  {
    date: '2026-10-11',
    title: 'Fewer triangles for the stars',
    notes: ['Only the stars bright enough to see are drawn each frame (a few thousand instead of all 112,000), so the triangle count in the cost panel drops by about 200k with the same sky.'],
  },
  {
    date: '2026-10-11',
    title: 'Clear Earth, faster and sharper close to planets',
    notes: [
      'Earth no longer has a painted cloud layer over it, so the full 8K surface shows. The thin white lines across the land (rivers catching the sun\'s glint) are gone too; only open water glints.',
      'Atmospheres cost much less to draw: the sunlight through the air is looked up from a small table instead of being worked out again at every step of every pixel.',
      'Sky pixels inside an atmosphere no longer read any surface maps, and inside the sharp close-up patch the blurry whole-planet map is no longer read underneath it.',
      'Up close, the surface map is magnified with smooth filtering instead of blocky bilinear, and fine relief (rolling ground and small craters) fades in below the finest map detail on the Moon, Mars, Mercury, rocky moons and Earth\'s land. It shows best with a low Sun.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'A sharper sky',
    notes: [
      'A new Milky Way built from ESA Gaia\'s sky map, with crisp dust lanes, no blotches and no seam.',
      'It now lines up with the real stars. The old one was rotated about 4 degrees off.',
      'Thousands of faint stars are drawn sharp inside the Milky Way, more of them on higher graphics settings.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'No blue spot on the canopy',
    notes: ['The coloured lens reflections from the Sun are gone, including the blue spot that sat near the top of the view when the Sun was just above it.'],
  },
  {
    date: '2026-10-11',
    title: 'Faster ship drawing',
    notes: [
      'The canopy glass, which fills most of the view from the cockpit, now costs a fraction of what it did and looks the same.',
      'Cabin lights only cost something where they actually reach, and the warp light costs nothing while it is off.',
      'The cost panel shows the canopy glass as its own line.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'A fast, cleaner map',
    notes: [
      'The map opens and pans smoothly: the 3D scene pauses behind it, and lines far off screen are no longer drawn.',
      'New look: a deep-space backdrop, orbits tinted by each planet, hover highlights, and the selected body marked in the list.',
      'Orbit lines always run exactly through their planet or moon, even fully zoomed in.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Reverse thrust',
    notes: [
      'The ship can now fly backwards, at up to half its forward speed and with half the acceleration.',
      'Keyboard: S pulls the throttle down to zero and stops there; let go and press S again to go into reverse. X brakes from either direction.',
      'Touch: tap the new REV button above the throttle to fly backwards, and tap it again for forward.',
      'The speed bar turns orange and the readout says REVERSE while you are backing up.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'A steadier, brighter Sun',
    notes: [
      'The Sun no longer flickers or flashes the screen white when it is only a few pixels wide.',
      'New glare around the Sun: a hot core, soft halo, diffraction spikes and fine streaks that hold still as you look around.',
      'The glare fades smoothly behind the cockpit frame and at the edge of the screen instead of popping on and off.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Choose your resolution',
    notes: [
      'Settings has a new Resolution option. Auto keeps the automatic choice made by the graphics quality and the frame rate.',
      'Pick 50% to 200% of your screen\'s pixels (each choice shows its size) to fix the resolution instead; automatic scaling then stays off.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Continue your flight',
    notes: [
      'The game remembers your last flight: Continue on the title screen puts the ship back next to the same planet or moon, facing the same way, with the same speed, view and warp target.',
      'New flight on the title screen starts over from low Earth orbit.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Seamless warp colours',
    notes: ['The warp tunnel\'s colours now blend all the way round, without the hard line on the left.'],
  },
  {
    date: '2026-10-11',
    title: 'Your pilot',
    notes: [
      'A suited, helmeted pilot now sits in a new seat, with gloved hands wrapped round the flight stick and throttle.',
      'The stick tilts and twists as you turn, the throttle follows your thrust, and the arms follow both; in first person you see your own arms and hands.',
      'The body leans into turns and is pressed back into the seat under boost and warp.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Cost panel on phones',
    notes: ['On phones and tablets the frame-cost panel under the FPS counter starts closed so it no longer covers the roll buttons. Tap the FPS readout to open it.'],
  },
  {
    date: '2026-10-11',
    title: 'True-scale maps',
    notes: [
      'Planets, moons and the Sun are drawn at their true size and tilt on the map, with Saturn\'s rings to scale.',
      'The target ring sits exactly on the body, and the warp arrival point is marked separately.',
      'Orbit lines no longer show a doubled seam, and the Sun view fits out to Pluto.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Better touch flight',
    notes: [
      'Look around with one finger while the other thumb steers, and double-tap to look ahead again.',
      'Boost and brake buttons beside the throttle, which now shows its percentage.',
      'Finer aiming with the stick, and clearer menus that close after a choice.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Faster frames',
    notes: ['The final image, ship shadows and ship lighting cost less, especially on high and ultra.'],
  },
  {
    date: '2026-10-11',
    title: 'Hull fix',
    notes: ['Fixed the inside-out hull that let the interior show through, and the pilot is visible again through the canopy.'],
  },
  {
    date: '2026-10-11',
    title: 'Frame cost breakdown',
    notes: ['Under the FPS counter, a breakdown of what each part of the frame costs, plus the GPU and quality details. Click the FPS readout to hide it.'],
  },
  {
    date: '2026-10-11',
    title: 'Scanner minimap',
    notes: ['A small 3D scanner in the HUD shows the Sun, planets, nearby moons and the warp target around the ship. Click it to open the map, or press N to hide it.'],
  },
  {
    date: '2026-10-11',
    title: 'Patch notes',
    notes: ['The title screen now lists what changed in each update.'],
  },
  {
    date: '2026-10-11',
    title: 'Warp from the cockpit',
    notes: ['The warp tunnel stays outside the ship, with only a faint shimmer and a sweep of blue light inside.'],
  },
  {
    date: '2026-10-11',
    title: 'Faster graphics',
    notes: ['Medium, high and ultra quality run fast again, with sharper anti-aliasing.'],
  },
  {
    date: '2026-10-11',
    title: 'New title screen',
    notes: [
      'A minimal loading screen, then the title over the live scene with the ship circling behind it.',
      'Press Launch, Enter or Space to take off.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Warp trails',
    notes: ['Warp streaks now ripple and morph around the ship instead of dashing past.'],
  },
  {
    date: '2026-10-11',
    title: 'Cleaner engines',
    notes: ['Removed the exhaust tubes, keeping only the glow at the nozzles.'],
  },
  {
    date: '2026-10-11',
    title: 'Cockpit and mobile',
    notes: [
      'A solid canopy and an animated pilot in the cockpit.',
      'Landscape layout for phones, with full screen and a rotate prompt.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'Field of view',
    notes: ['A field of view slider in settings.'],
  },
  {
    date: '2026-10-11',
    title: 'Mouse flight toggle',
    notes: ['Right-click turns mouse flight on and off.'],
  },
  {
    date: '2026-10-11',
    title: 'Always up to date',
    notes: ['The app now loads the latest version instead of a stale cached one.'],
  },
  {
    date: '2026-10-11',
    title: 'Sharper planets',
    notes: ['Large planet maps stream only the part you can see, so close-ups load faster and look sharper.'],
  },
  {
    date: '2026-10-11',
    title: 'Engines and warp',
    notes: [
      'An FPS counter, new engines and a wilder warp effect.',
      'Smoother mouse flight, and an update button when a new version is ready.',
    ],
  },
  {
    date: '2026-10-11',
    title: 'First flight',
    notes: ['A spaceship in a real-scale Solar System with real planet maps, 112,699 stars and live positions.'],
  },
];

/** The version shown for the entry at `index` in PATCH_NOTES: 0.1 for the oldest, counting up. */
export function patchVersion(index: number): string {
  return `0.${PATCH_NOTES.length - index}`;
}
