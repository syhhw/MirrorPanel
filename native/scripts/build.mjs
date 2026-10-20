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
console.log('Electron build OK');
