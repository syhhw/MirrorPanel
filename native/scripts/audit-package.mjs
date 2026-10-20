import { listPackage } from '@electron/asar';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = join(process.cwd(), 'dist/MirrorPanel-win32-x64');
const entries = listPackage(join(root, 'resources/app.asar')).map((name) =>
  name.replaceAll('\\', '/'),
);
assert.ok(entries.includes('/build/desktop/main.cjs'));
assert.ok(
  entries.every(
    (name) =>
      name === '/build' ||
      name.startsWith('/build/desktop') ||
      name === '/package.json' ||
      name === '/LICENSE',
  ),
  'Unexpected source in app.asar',
);
// Every extra resource must be one MirrorPanel ships on purpose; anything else
// (other apps, test fixtures, stray downloads) fails the audit.
const RESOURCES = new Set([
  'LICENSE-MirrorPanel.txt',
  'LICENSE-mp4-muxer.txt',
  'adb/adb.exe',
  'adb/AdbWinApi.dll',
  'adb/AdbWinUsbApi.dll',
  'adb/NOTICE.txt',
  'mirrorpanel-companion.apk',
  'mirrorpanel-companion.apk.idsig',
  'mirrorpanel-server.jar',
]);
const manifest = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else {
      const rel = relative(root, path).replaceAll('\\', '/');
      if (rel.startsWith('resources/resources/'))
        assert.ok(
          RESOURCES.has(rel.slice('resources/resources/'.length)),
          'Unexpected resource: ' + rel,
        );
      assert.ok(!/\.(keystore|jks|p12|pfx)$/i.test(rel), 'Private key in package: ' + rel);
      const bytes = readFileSync(path);
      manifest.push({
        path: rel,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
walk(root);
const result = {
  ok: true,
  version: JSON.parse(readFileSync('package.json', 'utf8')).version,
  asarEntries: entries,
  files: manifest,
  noPrivateKeys: true,
  onlyKnownResources: true,
};
writeFileSync('build/smoke/package-manifest.json', JSON.stringify(result, null, 2));
console.log('PACKAGE_AUDIT_OK', manifest.length, 'files; only known resources; no private keys');
