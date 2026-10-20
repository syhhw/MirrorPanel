import { basename, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { Adb } from './adb';
import { t } from './i18n';

/** Where dropped files land on the phone; every file manager shows this folder. */
export const PHONE_FOLDER = '/sdcard/Download';
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 4 * 1024 ** 3;

export interface DroppedFile {
  path: string;
  name: string;
  size: number;
}

/**
 * Only absolute paths on this computer. Network shares (\\host\share) are refused:
 * opening one would make Windows authenticate to that host with the user's account.
 */
export function isLocalPath(path: string): boolean {
  return isAbsolute(path) && !/^[\\/]{2}/.test(path) && !path.includes('\0');
}

export async function validateDroppedFiles(value: unknown): Promise<DroppedFile[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES)
    throw Error(
      t(`Send 1 to ${MAX_FILES} files at a time.`, `Envie de 1 a ${MAX_FILES} arquivos por vez.`),
    );
  const files: DroppedFile[] = [];
  for (const path of value) {
    if (typeof path !== 'string' || !path)
      throw Error(
        t('Drop files saved on this computer.', 'Arraste arquivos salvos neste computador.'),
      );
    if (!isLocalPath(path))
      throw Error(
        t(
          'Only files on this computer can be sent.',
          'Só arquivos deste computador podem ser enviados.',
        ),
      );
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile())
      throw Error(t('Folders cannot be sent.', 'Pastas não podem ser enviadas.'));
    if (info.size > MAX_FILE_BYTES)
      throw Error(t('File larger than 4 GB: ', 'Arquivo maior que 4 GB: ') + basename(path));
    files.push({ path, name: basename(path), size: info.size });
  }
  return files;
}

/** A file name Android accepts that does not overwrite anything already in the folder. */
export function phoneName(original: string, taken: ReadonlySet<string>): string {
  const clean =
    original
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
      .trim()
      .replace(/^\.+/, '')
      .slice(-120) || 'arquivo';
  if (!taken.has(clean)) return clean;
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const extension = dot > 0 ? clean.slice(dot) : '';
  for (let copy = 1; ; copy++) {
    const candidate = `${stem} (${copy})${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** USB 2 moves at least a few MB/s; allow one second per MB on top of a minute. */
const pushTimeout = (bytes: number) => 60000 + Math.ceil(bytes / 1_000_000) * 1000;

/** Copies dropped files to the phone, one transfer at a time per device. */
export class FileSender {
  private busy = new Set<string>();
  constructor(private adb: Adb) {}
  async send(serial: string, files: DroppedFile[]): Promise<string[]> {
    if (this.busy.has(serial))
      throw Error(
        t('Wait for the current transfer to finish.', 'Aguarde a transferência atual terminar.'),
      );
    this.busy.add(serial);
    try {
      const listing = await this.adb.shell(serial, ['ls', '-1', PHONE_FOLDER]).catch(() => '');
      const taken = new Set(
        listing
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean),
      );
      const saved: string[] = [];
      for (const file of files) {
        const name = phoneName(file.name, taken);
        taken.add(name);
        const target = PHONE_FOLDER + '/' + name;
        await this.adb.device(serial, ['push', file.path, target], pushTimeout(file.size));
        // Lets galleries list photos and videos right away; Download itself needs no scan.
        await this.adb
          .shell(serial, [
            'am',
            'broadcast',
            '-a',
            'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
            '-d',
            'file://' + PHONE_FOLDER + '/' + encodeURIComponent(name),
          ])
          .catch(() => '');
        saved.push(name);
      }
      return saved;
    } finally {
      this.busy.delete(serial);
    }
  }
}
