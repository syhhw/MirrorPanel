/** The part of the panel BrowserWindow that a second launch needs. */
export interface PanelWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/**
 * Brings the running panel forward when the app is launched again.
 *
 * Returns false when there is no live panel: before it is created, or once it
 * closed on the way out. Electron throws when a destroyed window is touched, so
 * it is checked before anything else.
 */
export function revealPanel(panel: PanelWindow | undefined): boolean {
  if (!panel || panel.isDestroyed()) return false;
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
  return true;
}
