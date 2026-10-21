import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { once } from 'node:events';
import { t } from './i18n';

/** A newer release the app can install: its setup file on GitHub. */
export interface Update {
  version: string;
  url: string;
  size: number;
  sha256: string;
}

interface Version {
  numbers: [number, number, number];
  /** The preview number; undefined for a stable version. */
  preview?: number;
}

/** Reads 2.0.0, 2.0.0-preview.5 or a release tag such as v2.0.0-preview.5. */
export function parseVersion(value: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    preview: match[4] === undefined ? undefined : Number(match[4]),
  };
}

/** Below zero when a is older than b. A preview comes before the stable version it leads to. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
  return (a.preview ?? Number.MAX_SAFE_INTEGER) - (b.preview ?? Number.MAX_SAFE_INTEGER);
}

type Release = { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
type Asset = { name?: unknown; size?: unknown; digest?: unknown; browser_download_url?: unknown };

/**
 * The newest release above `current` that lists MirrorPanel-Setup-<version>.exe under
 * `downloads` with a SHA-256 digest. A preview build is offered previews and stable
 * releases; a stable build only stable ones.
 */
export function pickUpdate(
  current: string,
  releases: unknown,
  downloads: string,
): Update | undefined {
  const running = parseVersion(current);
  if (!running || !Array.isArray(releases)) return undefined;
  let best: { version: Version; update: Update } | undefined;
  for (const release of releases as Release[]) {
    if (!release || typeof release.tag_name !== 'string' || release.draft) continue;
    const version = parseVersion(release.tag_name);
    if (!version || compareVersions(version, running) <= 0) continue;
    const preview = release.prerelease === true || version.preview !== undefined;
    if (preview && running.preview === undefined) continue;
    const name = `MirrorPanel-Setup-${release.tag_name.replace(/^v/, '')}.exe`;
    const assets = Array.isArray(release.assets) ? (release.assets as Asset[]) : [];
    const asset = assets.find((a) => a?.name === name);
    const sha256 = /^sha256:([0-9a-f]{64})$/.exec(String(asset?.digest))?.[1];
    const url = String(asset?.browser_download_url);
    const size = asset?.size;
    if (!sha256 || !url.startsWith(downloads) || typeof size !== 'number') continue;
    if (!Number.isSafeInteger(size) || size <= 0) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      update: { version: release.tag_name.replace(/^v/, ''), url, size, sha256 },
    };
  }
  return best?.update;
}

/**
 * Saves the setup at `path`. It stops as soon as more bytes arrive than the release
 * announced, and deletes the file unless its size and SHA-256 match.
 */
export async function downloadUpdate(
  update: Update,
  path: string,
  fetcher: (url: string) => Promise<Response>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const damaged = () =>
    Error(
      t(
        'The downloaded update is damaged. Try again.',
        'A atualização baixada veio com defeito. Tente de novo.',
      ),
    );
  let response: Response;
  try {
    response = await fetcher(update.url);
  } catch {
    response = Response.error();
  }
  if (!response.ok || !response.body)
    throw Error(
      t(
        'Could not download the update. Check the connection and try again.',
        'Não foi possível baixar a atualização. Verifique a conexão e tente de novo.',
      ),
    );
  const hash = createHash('sha256');
  const file = createWriteStream(path);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > update.size) throw damaged();
      hash.update(value);
      if (!file.write(value)) await once(file, 'drain');
      onProgress(received / update.size);
    }
    await new Promise<void>((resolve, reject) =>
      file.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
    if (received !== update.size || hash.digest('hex') !== update.sha256) throw damaged();
  } catch (error) {
    void reader.cancel().catch(() => {});
    // The file may still be opening; deleting it before it closes would leave it behind.
    if (!file.closed) {
      const closed = once(file, 'close');
      file.destroy();
      await closed;
    }
    await rm(path, { force: true });
    throw error;
  }
}
