/** What the mirror window does with one encoded video frame. */
export type FrameAction =
  /** No codec configuration yet: nothing can be decoded. */
  | 'ignore'
  /** Skip the frame while waiting for a keyframe. */
  | 'drop'
  /** Skip the frame and ask Android for a keyframe. */
  | 'drop-and-sync'
  /** Recreate the decoder, then decode this keyframe. */
  | 'restart-and-decode'
  | 'decode';

export interface DecoderState {
  /** False before the first configuration and after a new stream starts. */
  exists: boolean;
  /** WebCodecs closes the decoder by itself after a decoding error. */
  closed: boolean;
  /** Configured and not fed yet, so a keyframe needs no new decoder. */
  fresh: boolean;
  queueSize: number;
}

/** Frames waiting inside the decoder before we fall back to the next keyframe. */
export const MAX_DECODE_QUEUE = 3;

export function admitFrame(
  decoder: DecoderState,
  hasConfig: boolean,
  needsKey: boolean,
  key: boolean,
): FrameAction {
  if (!hasConfig || !decoder.exists) return 'ignore';
  // A closed decoder only comes back with a keyframe; until then keep asking for one.
  if (decoder.closed) return key ? 'restart-and-decode' : 'drop-and-sync';
  if (decoder.queueSize > MAX_DECODE_QUEUE) return 'drop-and-sync';
  if (!needsKey) return 'decode';
  if (!key) return 'drop';
  return decoder.fresh ? 'decode' : 'restart-and-decode';
}
