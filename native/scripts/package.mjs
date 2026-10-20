import { packager } from '@electron/packager';
import { existsSync } from 'node:fs';
// Output folder: dist by default; the installer build passes its own.
const out = process.argv[2] ?? 'dist';
for (const resource of ['mirrorpanel-server.jar', 'mirrorpanel-companion.apk', 'adb/adb.exe'])
  if (!existsSync('resources/' + resource))
    throw Error('Missing resource: ' + resource + '; run npm run android');
const output = await packager({
  dir: '.',
  name: 'MirrorPanel',
  platform: 'win32',
  arch: 'x64',
  out,
  overwrite: true,
  asar: true,
  prune: false,
  extraResource: ['resources'],
  icon: 'design/logo/mirrorpanel.ico',
  ignore: (file) =>
    file !== '' &&
    !file.startsWith('/build/desktop') &&
    file !== '/build' &&
    !['/package.json', '/LICENSE'].includes(file),
  appCopyright: 'MirrorPanel contributors',
  appVersion: '2.0.0-preview.5',
  buildVersion: '2.0.0.5',
  win32metadata: {
    CompanyName: 'MirrorPanel',
    FileDescription: 'MirrorPanel — original Android mirroring engine',
    ProductName: 'MirrorPanel',
  },
});
console.log('Package OK:', output.join('\n'));
