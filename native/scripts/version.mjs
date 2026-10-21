import { readFileSync } from 'node:fs';

/** The app version. package.json is the only place it is set. */
export const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

/** Windows file versions are four numbers: 2.0.0-preview.5 becomes 2.0.0.5. */
export const fileVersion = [...version.matchAll(/\d+/g), [0], [0], [0], [0]]
  .slice(0, 4)
  .map((m) => m[0])
  .join('.');
