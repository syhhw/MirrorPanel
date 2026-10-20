import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Adb } from '../src/adb';
import { MirrorSession, DEFAULT_QUALITY } from '../src/session';

const resources = mkdtempSync(join(tmpdir(), 'mirrorpanel-companion-'));
const apk = Buffer.from('bundled companion apk');
writeFileSync(join(resources, 'mirrorpanel-companion.apk'), apk);
const bundled = createHash('sha256').update(apk).digest('hex');

class Phone extends Adb {
  commands: string[] = [];
  constructor(
    private installedDigest: string | null,
    private installError?: string,
  ) {
    super('unused');
  }
  override async shell(_serial: string, args: string[]): Promise<string> {
    this.commands.push(args.join(' '));
    if (args[0] === 'pm')
      return this.installedDigest === null ? '' : 'package:/data/app/~~x/base.apk\n';
    if (args[0] === 'sha256sum') return `${this.installedDigest}  ${args[1]}\n`;
    return '';
  }
  override async device(_serial: string, args: string[]): Promise<string> {
    this.commands.push(args.join(' '));
    if (args[0] === 'install' && this.installError) throw Error(this.installError);
    return '';
  }
}
const ensure = (phone: Phone) =>
  (
    new MirrorSession('fixture', DEFAULT_QUALITY, phone, resources) as unknown as {
      ensureCompanion(): Promise<string>;
    }
  ).ensureCompanion();

test('the same Companion APK is kept without reinstalling', async () => {
  const phone = new Phone(bundled);
  assert.equal(await ensure(phone), 'kept');
  assert.ok(!phone.commands.some((c) => c.startsWith('install')));
});

test('a missing or different Companion is installed', async () => {
  const missing = new Phone(null);
  assert.equal(await ensure(missing), 'installed');
  assert.ok(missing.commands.some((c) => c.startsWith('install -r -g')));
  assert.equal(await ensure(new Phone('0'.repeat(64))), 'installed');
});

test('a Companion signed by another build gets an actionable message', async () => {
  const phone = new Phone('0'.repeat(64), 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: x]');
  await assert.rejects(ensure(phone), /Desinstale-o no Android/);
});
