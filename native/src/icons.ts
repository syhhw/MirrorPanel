/**
 * Interface icons: one family on a 24 px grid, 1.75 px round strokes, drawn for
 * MirrorPanel. Android navigation keeps Android's own back / home / recents shapes.
 */
const shapes: Record<string, string> = {
  phone: '<rect x="6.5" y="2.75" width="11" height="18.5" rx="2.75"/><path d="M10.5 18h3"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.75h-4.75"/>',
  wifi: '<path d="M2.75 9a14 14 0 0 1 18.5 0"/><path d="M5.9 12.4a9.5 9.5 0 0 1 12.2 0"/><path d="M9.1 15.8a5 5 0 0 1 5.8 0"/><circle cx="12" cy="19.25" r="1.1" fill="currentColor" stroke="none"/>',
  sliders:
    '<path d="M4 7.5h8.5M16.5 7.5H20M4 16.5h3.5M11.5 16.5H20"/><circle cx="14.5" cy="7.5" r="2"/><circle cx="9.5" cy="16.5" r="2"/>',
  play: '<path d="M8.5 5.75v12.5L18.5 12z" fill="currentColor"/>',
  show: '<path d="M14 4.5h5.5V10M19.5 4.5 13 11M10 19.5H4.5V14M4.5 19.5 11 13"/>',
  capture:
    '<path d="M4 8.75A2.25 2.25 0 0 1 6.25 6.5H8l1.5-2h5l1.5 2h1.75A2.25 2.25 0 0 1 20 8.75v8.5a2.25 2.25 0 0 1-2.25 2.25H6.25A2.25 2.25 0 0 1 4 17.25z"/><circle cx="12" cy="13" r="3.25"/>',
  record:
    '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5 21 7.75v8.5l-5.5-2.75"/>',
  audio:
    '<path d="M4.5 15v-2.5a7.5 7.5 0 0 1 15 0V15"/><rect x="3.75" y="13.75" width="4" height="6.5" rx="1.75"/><rect x="16.25" y="13.75" width="4" height="6.5" rx="1.75"/>',
  fullscreen:
    '<path d="M8.5 3.75H5.25a1.5 1.5 0 0 0-1.5 1.5V8.5M15.5 3.75h3.25a1.5 1.5 0 0 1 1.5 1.5V8.5M20.25 15.5v3.25a1.5 1.5 0 0 1-1.5 1.5H15.5M3.75 15.5v3.25a1.5 1.5 0 0 0 1.5 1.5H8.5"/>',
  more: '<circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>',
  back: '<path d="M14.75 5.5 8.25 12l6.5 6.5"/>',
  home: '<circle cx="12" cy="12" r="6.75"/>',
  recent: '<rect x="5.75" y="5.75" width="12.5" height="12.5" rx="2.5"/>',
  paste:
    '<path d="M9 4.5H7.25A2.25 2.25 0 0 0 5 6.75v12.5a2.25 2.25 0 0 0 2.25 2.25h9.5A2.25 2.25 0 0 0 19 19.25V6.75a2.25 2.25 0 0 0-2.25-2.25H15"/><rect x="9" y="2.75" width="6" height="3.5" rx="1.25"/>',
  power: '<path d="M12 3.25v8.25"/><path d="M6.7 6.7a7.5 7.5 0 1 0 10.6 0"/>',
  pin: '<path d="M9.25 3.75h5.5l-.9 5 3.4 3.4v1.85H6.75v-1.85l3.4-3.4z"/><path d="M12 14v6.25"/>',
  download: '<path d="M12 4.25v10.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.75h14"/>',
  help: '<circle cx="12" cy="12" r="8.75"/><path d="M9.6 9.6a2.45 2.45 0 1 1 3.35 2.25c-.65.3-.95.85-.95 1.5v.35"/><circle cx="12" cy="16.9" r=".95" fill="currentColor" stroke="none"/>',
  folder:
    '<path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.4l2 2.5H18a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 18 19.5H6a2.25 2.25 0 0 1-2.25-2.25z"/>',
  minimize: '<path d="M5.5 12h13"/>',
  maximize: '<rect x="5.75" y="5.75" width="12.5" height="12.5" rx="1.75"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  settings:
    '<path d="M10.28 5.11L10.63 2.85A9.25 9.25 0 0 1 13.37 2.85L13.72 5.11A7.1 7.1 0 0 1 15.66 5.91L17.50 4.56A9.25 9.25 0 0 1 19.44 6.50L18.09 8.34A7.1 7.1 0 0 1 18.89 10.28L21.15 10.63A9.25 9.25 0 0 1 21.15 13.37L18.89 13.72A7.1 7.1 0 0 1 18.09 15.66L19.44 17.50A9.25 9.25 0 0 1 17.50 19.44L15.66 18.09A7.1 7.1 0 0 1 13.72 18.89L13.37 21.15A9.25 9.25 0 0 1 10.63 21.15L10.28 18.89A7.1 7.1 0 0 1 8.34 18.09L6.50 19.44A9.25 9.25 0 0 1 4.56 17.50L5.91 15.66A7.1 7.1 0 0 1 5.11 13.72L2.85 13.37A9.25 9.25 0 0 1 2.85 10.63L5.11 10.28A7.1 7.1 0 0 1 5.91 8.34L4.56 6.50A9.25 9.25 0 0 1 6.50 4.56L8.34 5.91A7.1 7.1 0 0 1 10.28 5.11Z"/><circle cx="12" cy="12" r="2.9"/>',
  lock: '<rect x="5.75" y="10.5" width="12.5" height="9.75" rx="2.25"/><path d="M8.75 10.5V8a3.25 3.25 0 0 1 6.5 0v2.5"/>',
};

/** Inline SVG for a named icon; decorative, so the button carries the label. */
export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${shapes[name] ?? shapes.phone}</svg>`;
}

/**
 * The MirrorPanel mark at title-bar size: the optical-size drawing from
 * design/logo/mirrorpanel-mark-small.svg, with ids prefixed per page.
 */
export function logoMark(): string {
  return `<svg class="logo-mark" viewBox="0 0 256 256" aria-hidden="true">
    <defs>
      <linearGradient id="mp-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1F4452"/><stop offset="1" stop-color="#0B181E"/></linearGradient>
      <linearGradient id="mp-real" x1="0" y1="44" x2="0" y2="212" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7CEBEC"/><stop offset="1" stop-color="#22A9B4"/></linearGradient>
      <clipPath id="mp-left"><rect width="128" height="256"/></clipPath>
      <clipPath id="mp-right"><rect x="128" width="128" height="256"/></clipPath>
    </defs>
    <rect width="256" height="256" rx="60" fill="url(#mp-tile)"/>
    <path clip-path="url(#mp-left)" d="M38 212V46h50l40 62 40-62h50v166h-46v-86l-30 46h-28l-30-46v86Z" fill="url(#mp-real)" stroke="url(#mp-real)" stroke-width="12" stroke-linejoin="round"/>
    <path clip-path="url(#mp-right)" d="M38 212V46h50l40 62 40-62h50v166h-46v-86l-30 46h-28l-30-46v86Z" fill="#DDF8F9" fill-opacity=".8" stroke="#DDF8F9" stroke-opacity=".8" stroke-width="12" stroke-linejoin="round"/>
  </svg>`;
}
