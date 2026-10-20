export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const MIRROR_BARS = 86;
export const MIRROR_MIN_WIDTH = 240;
export const RESIZE_SETTLE_MS = 500;
/** Share of the free screen height a new portrait mirror takes, close to Vysor's first window. */
const PORTRAIT_SHARE = 0.85;

/** Width/height of the device screen from `wm size`; an override (custom resolution) wins. */
export function parseDisplayRatio(output: string): number | undefined {
  const sizes = [...output.matchAll(/(\d+)x(\d+)/g)];
  const last = sizes.at(-1);
  if (!last) return undefined;
  const width = Number(last[1]),
    height = Number(last[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

/**
 * Content size of a new mirror window for a video with this ratio. The window opens
 * with its final shape, so the first frame does not make it jump.
 */
export function initialMirrorSize(ratio: number, area: Bounds): { width: number; height: number } {
  if (!Number.isFinite(ratio) || ratio <= 0) throw Error('Invalid display ratio');
  const free = Math.max(1, area.height - 64 - MIRROR_BARS);
  const preferred = ratio > 1 ? 960 : free * PORTRAIT_SHARE * ratio;
  const width = Math.floor(
    Math.max(MIRROR_MIN_WIDTH, Math.min(preferred, area.width - 40, free * ratio)),
  );
  return { width, height: Math.round(width / ratio) + MIRROR_BARS };
}

/** Native drag is free. After settling, fit to its longest side and preserve its top-left. */
export function accommodatedBounds(
  bounds: Bounds,
  ratio: number,
  area: Bounds,
  extra = { width: 0, height: MIRROR_BARS },
): Bounds {
  if (!Number.isFinite(ratio) || ratio <= 0) throw Error('Invalid display ratio');
  const square = Math.max(bounds.width - extra.width, bounds.height - extra.height);
  const wanted = ratio >= 1 ? square : square * ratio;
  const maximum = Math.max(
    1,
    Math.min(area.width - extra.width, (area.height - extra.height) * ratio),
  );
  const minimum = Math.min(maximum, Math.max(1, MIRROR_MIN_WIDTH - extra.width));
  const videoWidth = Math.min(maximum, Math.max(minimum, wanted));
  const width = Math.round(videoWidth) + extra.width,
    height = Math.round(videoWidth / ratio) + extra.height;
  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
    width,
    height,
  };
}
