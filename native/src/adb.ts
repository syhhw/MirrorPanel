import { execFile, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { t } from './i18n';
const execute = promisify(execFile);
export interface Device {
  serial: string;
  state: string;
  model: string;
  physicalId?: string;
}
export function parseDevices(text: string): Device[] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || parts[0].startsWith('*')) return [];
      return [
        {
          serial: parts[0],
          state: parts[1],
          model: (parts.find((p) => p.startsWith('model:'))?.slice(6) ?? parts[0]).replaceAll(
            '_',
            ' ',
          ),
        },
      ];
    });
}
export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export class Adb {
  constructor(readonly executable: string) {}
  async run(args: string[], timeout = 15000): Promise<string> {
    try {
      const result = await execute(this.executable, args, {
        timeout,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      });
      return result.stdout.trim();
    } catch (error) {
      const failure = error as { stderr?: string; killed?: boolean; code?: string | number };
      // execFile's default message contains the full command, including bootstrap
      // credentials. Keep command arguments and token-bearing am output private.
      const detail = args.includes('shell')
        ? t('Falha no comando Android', 'Android command failed')
        : failure.stderr?.trim().slice(0, 1000);
      throw Error(
        failure.killed
          ? t('ADB excedeu o tempo limite', 'ADB timed out')
          : detail || t('Falha no ADB (', 'ADB failed (') + String(failure.code) + ')',
      );
    }
  }
  device(serial: string, args: string[], timeout = 15000): Promise<string> {
    return this.run(['-s', serial, ...args], timeout);
  }
  shell(serial: string, words: string[], timeout = 15000): Promise<string> {
    return this.device(serial, ['shell', words.map(shellQuote).join(' ')], timeout);
  }
  launch(
    serial: string,
    remote: string,
    name: string,
    maxSize: number,
    fps: number,
    bitrate: number,
  ): ChildProcessWithoutNullStreams {
    const command =
      'CLASSPATH=' +
      shellQuote(remote) +
      ' app_process / ' +
      ['com.mirrorpanel.server.Main', name, String(maxSize), String(fps), String(bitrate)]
        .map(shellQuote)
        .join(' ');
    return spawn(this.executable, ['-s', serial, 'shell', '-T', command], {
      windowsHide: true,
      stdio: 'pipe',
    });
  }
  async devices(): Promise<Device[]> {
    return parseDevices(await this.run(['devices', '-l']));
  }
}
