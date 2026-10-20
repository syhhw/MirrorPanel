import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Adb } from '../src/adb';
import { ApkInstaller, validateApk } from '../src/apk-install';
import { setLanguage } from '../src/i18n';

setLanguage('en');

test('APK validation rejects synthetic/non-APK paths and invalid containers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mp-apk-'));
  try {
    const invalid = join(directory, 'bad.apk');
    await writeFile(invalid, 'not a zip');
    for (const input of [undefined, 'relative.apk', join(directory, 'bad.txt'), invalid])
      await assert.rejects(validateApk(input));
    const valid = join(directory, 'café app with spaces & symbols.apk');
    await writeFile(valid, Buffer.from([0x50, 0x4b, 3, 4]));
    assert.equal(await validateApk(valid), valid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('ADB receives a literal path; installs are locked per device and require Success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mp-apk-'));
  const path = join(directory, 'a & b.apk');
  await writeFile(path, Buffer.from([0x50, 0x4b, 3, 4]));
  let release: (value: string) => void = () => {},
    entered: () => void = () => {};
  const started = new Promise<void>((resolve) => (entered = resolve));
  class FakeAdb extends Adb {
    override async device(serial: string, args: string[]): Promise<string> {
      assert.equal(serial, 'phone');
      assert.deepEqual(args, ['install', '-r', path]);
      entered();
      return new Promise((resolve) => (release = resolve));
    }
  }
  const installer = new ApkInstaller(new FakeAdb('unused'));
  try {
    const pending = installer.install('phone', path);
    await started;
    await assert.rejects(installer.install('phone', path), /Wait for the current installation/);
    release('Performing Streamed Install\nSuccess');
    assert.equal(await pending, 'a & b.apk');
    class FailedAdb extends Adb {
      override async device(): Promise<string> {
        return 'Failure [INSTALL_FAILED_INVALID_APK]';
      }
    }
    await assert.rejects(
      new ApkInstaller(new FailedAdb('unused')).install('phone', path),
      /did not confirm/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
