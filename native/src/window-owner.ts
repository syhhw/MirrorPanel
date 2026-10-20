/** The part of an Electron BrowserWindow needed to match IPC senders. */
export interface OwnedWindow {
  isDestroyed(): boolean;
  readonly webContents: unknown;
}

/**
 * Finds the entry whose window sent an IPC message.
 *
 * A session keeps its entry while it stops, which can outlive its window, and
 * Electron throws when webContents is read from a destroyed window. Destroyed
 * windows are skipped before comparing, so closing one mirror while another is
 * streaming cannot break the other window's messages.
 */
export function findBySender<T extends { window: OwnedWindow }>(
  entries: Iterable<T>,
  sender: unknown,
): T | undefined {
  for (const entry of entries) {
    if (!entry.window.isDestroyed() && entry.window.webContents === sender) return entry;
  }
  return undefined;
}
