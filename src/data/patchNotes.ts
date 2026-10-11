// Patch notes shown on the title screen, newest first. Add an entry at the top for each update.

export interface PatchNote {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: '0.25',
    date: '2026-10-11',
    title: 'A steadier, brighter Sun',
    notes: [
      'The Sun no longer flickers or flashes the screen white when it is only a few pixels wide.',
      'New glare around the Sun: a hot core, soft halo, diffraction spikes and fine streaks that hold still as you look around.',
      'The glare fades smoothly behind the cockpit frame and at the edge of the screen instead of popping on and off.',
    ],
  },
  {
    version: '0.24',
    date: '2026-10-11',
    title: 'Choose your resolution',
    notes: [
      'Settings has a new Resolution option. Auto keeps the automatic choice made by the graphics quality and the frame rate.',
      'Pick 50% to 200% of your screen\'s pixels (each choice shows its size) to fix the resolution instead; automatic scaling then stays off.',
    ],
  },
  {
    version: '0.23',
    date: '2026-10-11',
    title: 'Continue your flight',
    notes: [
      'The game remembers your last flight: Continue on the title screen puts the ship back next to the same planet or moon, facing the same way, with the same speed, view and warp target.',
      'New flight on the title screen starts over from low Earth orbit.',
    ],
  },
  {
    version: '0.22',
    date: '2026-10-11',
    title: 'Seamless warp colours',
    notes: ['The warp tunnel\'s colours now blend all the way round, without the hard line on the left.'],
  },
  {
    version: '0.21',
    date: '2026-10-11',
    title: 'Your pilot',
    notes: [
      'A suited, helmeted pilot now sits in a new seat, with gloved hands wrapped round the flight stick and throttle.',
      'The stick tilts and twists as you turn, the throttle follows your thrust, and the arms follow both; in first person you see your own arms and hands.',
      'The body leans into turns and is pressed back into the seat under boost and warp.',
    ],
  },
  {
    version: '0.20',
    date: '2026-10-11',
    title: 'Cost panel on phones',
    notes: ['On phones and tablets the frame-cost panel under the FPS counter starts closed so it no longer covers the roll buttons. Tap the FPS readout to open it.'],
  },
  {
    version: '0.19',
    date: '2026-10-11',
    title: 'True-scale maps',
    notes: [
      'Planets, moons and the Sun are drawn at their true size and tilt on the map, with Saturn\'s rings to scale.',
      'The target ring sits exactly on the body, and the warp arrival point is marked separately.',
      'Orbit lines no longer show a doubled seam, and the Sun view fits out to Pluto.',
    ],
  },
  {
    version: '0.18',
    date: '2026-10-11',
    title: 'Better touch flight',
    notes: [
      'Look around with one finger while the other thumb steers, and double-tap to look ahead again.',
      'Boost and brake buttons beside the throttle, which now shows its percentage.',
      'Finer aiming with the stick, and clearer menus that close after a choice.',
    ],
  },
  {
    version: '0.17',
    date: '2026-10-11',
    title: 'Faster frames',
    notes: ['The final image, ship shadows and ship lighting cost less, especially on high and ultra.'],
  },
  {
    version: '0.16',
    date: '2026-10-11',
    title: 'Hull fix',
    notes: ['Fixed the inside-out hull that let the interior show through, and the pilot is visible again through the canopy.'],
  },
  {
    version: '0.15',
    date: '2026-10-11',
    title: 'Frame cost breakdown',
    notes: ['Under the FPS counter, a breakdown of what each part of the frame costs, plus the GPU and quality details. Click the FPS readout to hide it.'],
  },
  {
    version: '0.14',
    date: '2026-10-11',
    title: 'Scanner minimap',
    notes: ['A small 3D scanner in the HUD shows the Sun, planets, nearby moons and the warp target around the ship. Click it to open the map, or press N to hide it.'],
  },
  {
    version: '0.13',
    date: '2026-10-11',
    title: 'Patch notes',
    notes: ['The title screen now lists what changed in each update.'],
  },
  {
    version: '0.12',
    date: '2026-10-11',
    title: 'Warp from the cockpit',
    notes: ['The warp tunnel stays outside the ship, with only a faint shimmer and a sweep of blue light inside.'],
  },
  {
    version: '0.11',
    date: '2026-10-11',
    title: 'Faster graphics',
    notes: ['Medium, high and ultra quality run fast again, with sharper anti-aliasing.'],
  },
  {
    version: '0.10',
    date: '2026-10-11',
    title: 'New title screen',
    notes: [
      'A minimal loading screen, then the title over the live scene with the ship circling behind it.',
      'Press Launch, Enter or Space to take off.',
    ],
  },
  {
    version: '0.9',
    date: '2026-10-11',
    title: 'Warp trails',
    notes: ['Warp streaks now ripple and morph around the ship instead of dashing past.'],
  },
  {
    version: '0.8',
    date: '2026-10-11',
    title: 'Cleaner engines',
    notes: ['Removed the exhaust tubes, keeping only the glow at the nozzles.'],
  },
  {
    version: '0.7',
    date: '2026-10-11',
    title: 'Cockpit and mobile',
    notes: [
      'A solid canopy and an animated pilot in the cockpit.',
      'Landscape layout for phones, with full screen and a rotate prompt.',
    ],
  },
  {
    version: '0.6',
    date: '2026-10-11',
    title: 'Field of view',
    notes: ['A field of view slider in settings.'],
  },
  {
    version: '0.5',
    date: '2026-10-11',
    title: 'Mouse flight toggle',
    notes: ['Right-click turns mouse flight on and off.'],
  },
  {
    version: '0.4',
    date: '2026-10-11',
    title: 'Always up to date',
    notes: ['The app now loads the latest version instead of a stale cached one.'],
  },
  {
    version: '0.3',
    date: '2026-10-11',
    title: 'Sharper planets',
    notes: ['Large planet maps stream only the part you can see, so close-ups load faster and look sharper.'],
  },
  {
    version: '0.2',
    date: '2026-10-11',
    title: 'Engines and warp',
    notes: [
      'An FPS counter, new engines and a wilder warp effect.',
      'Smoother mouse flight, and an update button when a new version is ready.',
    ],
  },
  {
    version: '0.1',
    date: '2026-10-11',
    title: 'First flight',
    notes: ['A spaceship in a real-scale Solar System with real planet maps, 112,699 stars and live positions.'],
  },
];
