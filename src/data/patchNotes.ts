// Patch notes shown on the title screen, newest first. Add an entry at the top for each update.

export interface PatchNote {
  version: string;
  date: string; // YYYY-MM-DD
  title: string;
  notes: string[];
}

export const PATCH_NOTES: PatchNote[] = [
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
