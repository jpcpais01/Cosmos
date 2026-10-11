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
