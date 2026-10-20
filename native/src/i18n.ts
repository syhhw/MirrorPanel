/**
 * Interface language. Each process keeps its own copy: the main process sets it
 * from the saved settings, the panel from its state and each mirror window from
 * its URL and later updates.
 */
export type Language = 'pt' | 'en';

let current: Language = 'pt';

export function setLanguage(language: Language): void {
  current = language;
}

export function language(): Language {
  return current;
}

/** Picks the English or Portuguese text for the current language. */
export function t(en: string, pt: string): string {
  return current === 'en' ? en : pt;
}
