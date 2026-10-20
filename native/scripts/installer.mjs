// Packages the app into build/installer (never dist/, which may hold a copy that
// is running), audits it and compiles installer/MirrorPanel.iss with Inno Setup 6.
// The installer lands in dist/. Extra ISCC defines can follow on the command line.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const stage = 'build/installer';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
// Windows file versions are four numbers: 2.0.0-preview.5 becomes 2.0.0.5.
const fileVersion = [...version.matchAll(/\d+/g), [0], [0], [0], [0]]
  .slice(0, 4)
  .map((m) => m[0])
  .join('.');

function iscc() {
  const candidates = [
    process.env.ISCC,
    join(process.env.LOCALAPPDATA ?? '', 'Programs/Inno Setup 6/ISCC.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6/ISCC.exe'),
    join(process.env.ProgramFiles ?? '', 'Inno Setup 6/ISCC.exe'),
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw Error('Inno Setup 6 not found; install it or set ISCC to ISCC.exe');
  return found;
}

const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });
run(process.execPath, ['scripts/package.mjs', stage]);
run(process.execPath, ['scripts/audit-package.mjs', stage]);
run(iscc(), [
  '/Qp',
  `/DAppVersion=${version}`,
  `/DFileVersion=${fileVersion}`,
  `/DSourceDir=${resolve(stage, 'MirrorPanel-win32-x64')}`,
  `/O${resolve('dist')}`,
  ...process.argv.slice(2),
  'installer/MirrorPanel.iss',
]);
console.log(`Installer OK: dist/MirrorPanel-Setup-${version}.exe`);
