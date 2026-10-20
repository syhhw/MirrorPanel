import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('build/desktop', { recursive: true });
await Promise.all([
  build({
    entryPoints: ['src/main.ts'],
    outfile: 'build/desktop/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    entryPoints: ['src/preload.ts'],
    outfile: 'build/desktop/preload.cjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    entryPoints: ['src/renderer.ts'],
    outfile: 'build/desktop/renderer.js',
    bundle: true,
    platform: 'browser',
    target: 'chrome130',
  }),
]);
for (const file of ['index.html', 'style.css'])
  await copyFile('src/' + file, 'build/desktop/' + file);
// Manrope (SIL Open Font License) ships with its license next to the font files.
const manrope = 'node_modules/@fontsource-variable/manrope';
await mkdir('build/desktop/fonts', { recursive: true });
for (const subset of ['latin', 'latin-ext'])
  await copyFile(
    `${manrope}/files/manrope-${subset}-wght-normal.woff2`,
    `build/desktop/fonts/manrope-${subset}.woff2`,
  );
await copyFile(`${manrope}/LICENSE`, 'build/desktop/fonts/OFL.txt');
await copyFile('design/logo/png/mirrorpanel-256.png', 'build/desktop/icon.png');
console.log('Electron build OK');
