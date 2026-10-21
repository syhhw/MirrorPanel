import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setLanguage } from '../src/i18n';
import { compareVersions, downloadUpdate, parseVersion, pickUpdate } from '../src/updater';

setLanguage('en');

const DOWNLOADS = 'https://github.com/syhhw/MirrorPanel/releases/download/';
const DIGEST = 'a'.repeat(64);

function release(tag: string, prerelease: boolean, asset: Record<string, unknown> = {}) {
  const version = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    draft: false,
    prerelease,
    assets: [
      {
        name: `MirrorPanel-Setup-${version}.exe`,
        size: 1000,
        digest: 'sha256:' + DIGEST,
        browser_download_url: `${DOWNLOADS}${tag}/MirrorPanel-Setup-${version}.exe`,
        ...asset,
      },
    ],
  };
}

test('versions order previews before the stable version they lead to', () => {
  const order = [
    '1.3.1',
    '2.0.0-preview.5',
    '2.0.0-preview.12',
    '2.0.0',
    '2.0.1-preview.1',
    '2.1.0',
  ];
  for (let i = 1; i < order.length; i++)
    assert.ok(compareVersions(parseVersion(order[i - 1])!, parseVersion(order[i])!) < 0, order[i]);
  assert.equal(compareVersions(parseVersion('v2.0.0')!, parseVersion('2.0.0')!), 0);
  assert.equal(parseVersion('2.0'), undefined);
  assert.equal(parseVersion('2.0.0-beta.1'), undefined);
});

test('a preview build is offered the newest preview or stable release', () => {
  const releases = [
    release('v2.0.0-preview.6', true),
    release('v2.0.0-preview.7', true),
    release('v1.3.1', false),
    release('v2.0.0-preview.5', true),
  ];
  assert.equal(pickUpdate('2.0.0-preview.5', releases, DOWNLOADS)?.version, '2.0.0-preview.7');
  const update = pickUpdate('2.0.0-preview.5', [...releases, release('v2.0.0', false)], DOWNLOADS);
  assert.deepEqual(update, {
    version: '2.0.0',
    url: `${DOWNLOADS}v2.0.0/MirrorPanel-Setup-2.0.0.exe`,
    size: 1000,
    sha256: DIGEST,
  });
  assert.equal(pickUpdate('2.0.0-preview.7', releases, DOWNLOADS), undefined);
});

test('a stable build is only offered stable releases', () => {
  const releases = [release('v2.0.1-preview.1', true), release('v2.0.1', false)];
  assert.equal(pickUpdate('2.0.0', releases, DOWNLOADS)?.version, '2.0.1');
  assert.equal(pickUpdate('2.0.0', [release('v2.0.1-preview.1', false)], DOWNLOADS), undefined);
  assert.equal(pickUpdate('2.0.0', [release('v2.1.0', true)], DOWNLOADS), undefined);
});

test('releases without a trustworthy setup are skipped', () => {
  const skipped = [
    { ...release('v2.0.0', false), draft: true },
    release('v2.0.0', false, { digest: undefined }),
    release('v2.0.0', false, { digest: 'sha1:' + 'a'.repeat(40) }),
    release('v2.0.0', false, { name: 'MirrorPanel-Setup.exe' }),
    release('v2.0.0', false, {
      browser_download_url: 'https://example.com/MirrorPanel-Setup-2.0.0.exe',
    }),
    release('v2.0.0', false, { size: 0 }),
    { tag_name: 'v2.0.0', assets: 'none' },
    null,
  ];
  for (const entry of skipped)
    assert.equal(pickUpdate('2.0.0-preview.5', [entry], DOWNLOADS), undefined);
  assert.equal(
    pickUpdate('2.0.0-preview.5', { message: 'API rate limit exceeded' }, DOWNLOADS),
    undefined,
  );
  assert.equal(pickUpdate('dev', [release('v2.0.0', false)], DOWNLOADS), undefined);
});

function served(bytes: Uint8Array<ArrayBuffer>) {
  return async () => new Response(new Blob([bytes]).stream());
}

test('a download is kept only when its size and SHA-256 match', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'mirrorpanel-update-'));
  const bytes = new TextEncoder().encode('setup bytes '.repeat(1000));
  const update = {
    version: '2.0.0',
    url: 'unused',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const good = join(folder, 'good.exe');
  const progress: number[] = [];
  await downloadUpdate(update, good, served(bytes), (fraction) => progress.push(fraction));
  assert.deepEqual(readFileSync(good), Buffer.from(bytes));
  assert.equal(progress.at(-1), 1);

  const tampered = join(folder, 'tampered.exe');
  await assert.rejects(
    downloadUpdate({ ...update, sha256: DIGEST }, tampered, served(bytes), () => {}),
    /damaged/,
  );
  assert.equal(existsSync(tampered), false);

  const oversized = join(folder, 'oversized.exe');
  await assert.rejects(
    downloadUpdate({ ...update, size: 10 }, oversized, served(bytes), () => {}),
    /damaged/,
  );
  assert.equal(existsSync(oversized), false);

  await assert.rejects(
    downloadUpdate(
      update,
      join(folder, 'offline.exe'),
      () => Promise.reject(Error('offline')),
      () => {},
    ),
    /Could not download/,
  );
  await assert.rejects(
    downloadUpdate(
      update,
      join(folder, 'missing.exe'),
      async () => new Response('', { status: 404 }),
      () => {},
    ),
    /Could not download/,
  );
});
