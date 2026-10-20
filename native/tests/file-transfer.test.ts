import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Adb } from '../src/adb';
import { validateApk } from '../src/apk-install';
import {
  FileSender,
  MAX_FILES,
  PHONE_FOLDER,
  isLocalPath,
  phoneName,
  validateDroppedFiles,
} from '../src/file-transfer';

const folder = mkdtempSync(join(tmpdir(), 'mirrorpanel-files-'));
const photo = join(folder, 'foto da praia.jpg');
writeFileSync(photo, 'jpeg bytes');

test('network shares and relative paths are not local files', () => {
  assert.equal(isLocalPath(photo), true);
  assert.equal(isLocalPath('\\\\attacker\\share\\x.apk'), false);
  assert.equal(isLocalPath('//attacker/share/x.apk'), false);
  assert.equal(isLocalPath('relative/x.jpg'), false);
});

test('a UNC APK path is refused before Windows can open it', async () => {
  await assert.rejects(validateApk('\\\\attacker\\share\\x.apk'), /APK local/);
});

test('dropped paths must be 1 to 20 existing local files', async () => {
  const [file] = await validateDroppedFiles([photo]);
  assert.deepEqual(file, { path: photo, name: 'foto da praia.jpg', size: 10 });
  await assert.rejects(validateDroppedFiles([]));
  await assert.rejects(validateDroppedFiles(Array(MAX_FILES + 1).fill(photo)));
  await assert.rejects(validateDroppedFiles(['']), /salvos neste computador/);
  await assert.rejects(validateDroppedFiles([folder]), /Pastas/);
  await assert.rejects(validateDroppedFiles(['\\\\host\\share\\a.jpg']), /deste computador/);
});

test('phone names are cleaned and never overwrite existing files', () => {
  assert.equal(phoneName('a:b*c?.txt', new Set()), 'a_b_c_.txt');
  assert.equal(phoneName('...hidden', new Set()), 'hidden');
  assert.equal(phoneName('', new Set()), 'arquivo');
  assert.equal(phoneName('foto.jpg', new Set(['foto.jpg', 'foto (1).jpg'])), 'foto (2).jpg');
  assert.equal(phoneName('notes', new Set(['notes'])), 'notes (1)');
});

class Phone extends Adb {
  commands: string[][] = [];
  release?: () => void;
  constructor(private listing: string) {
    super('unused');
  }
  override async shell(_serial: string, args: string[]): Promise<string> {
    this.commands.push(args);
    return args[0] === 'ls' ? this.listing : '';
  }
  override async device(_serial: string, args: string[]): Promise<string> {
    this.commands.push(args);
    if (this.release === undefined) await new Promise<void>((resolve) => (this.release = resolve));
    return '';
  }
}

test('files are pushed by argument list into Download, one transfer per device', async () => {
  const phone = new Phone('foto da praia.jpg\nother.txt\n');
  const sender = new FileSender(phone);
  const first = sender.send('serial', [{ path: photo, name: 'foto da praia.jpg', size: 10 }]);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(sender.send('serial', []), /transferência atual/);
  phone.release!();
  assert.deepEqual(await first, ['foto da praia (1).jpg']);
  assert.deepEqual(
    phone.commands.find((c) => c[0] === 'push'),
    ['push', photo, PHONE_FOLDER + '/foto da praia (1).jpg'],
  );
  const scan = phone.commands.find((c) => c[0] === 'am')!;
  assert.equal(scan.at(-1), 'file://' + PHONE_FOLDER + '/foto%20da%20praia%20(1).jpg');
  assert.deepEqual(await sender.send('serial', []), []);
});
