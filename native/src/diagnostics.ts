import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Local lifecycle metadata only: never record input, clipboard, tokens or ADB arguments. */
export class Diagnostics {
  readonly path: string;
  constructor(
    directory: string,
    private run: string,
  ) {
    this.path = join(directory, 'lifecycle.jsonl');
    try {
      mkdirSync(directory, { recursive: true });
    } catch {
      /* Keep the application usable if local diagnostics cannot be created. */
    }
  }
  write(event: string, data: Record<string, unknown> = {}): void {
    try {
      if (existsSync(this.path) && statSync(this.path).size > 2 * 1024 * 1024) {
        if (existsSync(this.path + '.1')) unlinkSync(this.path + '.1');
        renameSync(this.path, this.path + '.1');
      }
      appendFileSync(
        this.path,
        JSON.stringify({
          at: new Date().toISOString(),
          run: this.run,
          pid: process.pid,
          event,
          ...data,
        }) + '\n',
      );
    } catch {
      /* Diagnostics must never interrupt the mirroring lifecycle. */
    }
  }
}
