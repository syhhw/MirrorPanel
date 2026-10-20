import { Buffer } from 'node:buffer';
import { t } from './i18n';

export interface Packet {
  type: number;
  flags: number;
  pts: number;
  data: Buffer;
}
export interface VideoInfo {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  rotation: number;
  codec: 'h264';
  audio: boolean;
}
export const MAX_PACKET = 8 * 1024 * 1024;

/** Handles arbitrary TCP fragmentation without trusting device lengths. */
export class PacketReader {
  private buffer: Buffer = Buffer.alloc(0);
  feed(chunk: Buffer): Packet[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const result: Packet[] = [];
    let position = 0;
    while (this.buffer.length - position >= 20) {
      const head = this.buffer.subarray(position);
      if (head.readUInt32BE(0) !== 0x4d505631 || head.readUInt16BE(6) !== 0)
        throw Error(t('Protocolo de vídeo incompatível', 'Incompatible video protocol'));
      const type = head[4],
        flags = head[5],
        length = head.readUInt32BE(8);
      if (![1, 2, 3, 4, 5].includes(type) || flags > 3 || length > MAX_PACKET)
        throw Error(t('Pacote de vídeo inválido', 'Invalid video packet'));
      if (head.length < 20 + length) break;
      const pts = Number(head.readBigUInt64BE(12));
      if (!Number.isSafeInteger(pts)) throw Error(t('Timestamp inválido', 'Invalid timestamp'));
      result.push({ type, flags, pts, data: Buffer.from(head.subarray(20, 20 + length)) });
      position += 20 + length;
    }
    this.buffer = this.buffer.subarray(position);
    if (this.buffer.length > MAX_PACKET + 20)
      throw Error(t('Buffer de vídeo excedido', 'Video buffer exceeded'));
    return result;
  }
  end(): void {
    if (this.buffer.length)
      throw Error(t('Stream terminou com pacote truncado', 'Stream ended with a truncated packet'));
  }
}

export function parseInfo(data: Buffer): VideoInfo {
  const info = JSON.parse(data.toString('utf8')) as VideoInfo;
  if (
    info.codec !== 'h264' ||
    ![info.width, info.height, info.sourceWidth, info.sourceHeight].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 8192,
    )
  )
    throw Error(t('Dimensões de vídeo inválidas', 'Invalid video dimensions'));
  return info;
}

export function nalUnits(data: Uint8Array): Uint8Array[] {
  const starts: { offset: number; size: number }[] = [];
  for (let i = 0; i < data.length - 2; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) {
        starts.push({ offset: i, size: 3 });
        i += 2;
      } else if (data[i + 2] === 0 && data[i + 3] === 1) {
        starts.push({ offset: i, size: 4 });
        i += 3;
      }
    }
  }
  return starts
    .map((s, i) => data.subarray(s.offset + s.size, starts[i + 1]?.offset ?? data.length))
    .filter((n) => n.length > 0);
}

export function avcConfiguration(data: Uint8Array): { codec: string; description: Uint8Array } {
  const units = nalUnits(data),
    sps = units.find((n) => (n[0] & 31) === 7),
    pps = units.find((n) => (n[0] & 31) === 8);
  if (!sps || sps.length < 4 || !pps || sps.length > 65535 || pps.length > 65535)
    throw Error(t('SPS/PPS ausentes', 'Missing SPS/PPS'));
  const description = Buffer.concat([
    Buffer.from([1, sps[1], sps[2], sps[3], 255, 225, sps.length >> 8, sps.length & 255]),
    sps,
    Buffer.from([1, pps.length >> 8, pps.length & 255]),
    pps,
  ]);
  return { codec: 'avc1.' + Buffer.from(sps.subarray(1, 4)).toString('hex'), description };
}

export function lengthPrefixed(data: Uint8Array): Uint8Array {
  const units = nalUnits(data);
  if (!units.length) throw Error(t('H.264 Annex-B inválido', 'Invalid H.264 Annex-B'));
  return Buffer.concat(
    units.flatMap((n) => {
      const size = Buffer.alloc(4);
      size.writeUInt32BE(n.length);
      return [size, n];
    }),
  );
}

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
}
export type Control =
  | { type: 'touch'; action: number; id?: number; pointers?: TouchPoint[]; x?: number; y?: number }
  | { type: 'key'; code: number }
  | { type: 'text'; text: string }
  | { type: 'sync' | 'stop' };
export function validText(text: unknown): text is string {
  return (
    typeof text === 'string' &&
    Buffer.byteLength(text, 'utf8') <= 65536 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)
  );
}
export function validateControl(value: unknown): Control {
  if (!value || typeof value !== 'object') throw Error(t('Controle inválido', 'Invalid control'));
  const v = value as Record<string, unknown>;
  if (v.type === 'sync' || v.type === 'stop') return { type: v.type };
  if (v.type === 'key' && Number.isInteger(v.code) && Number(v.code) >= 0 && Number(v.code) <= 400)
    return { type: 'key', code: Number(v.code) };
  if (v.type === 'text' && validText(v.text)) return { type: 'text', text: v.text };
  const coordinate = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
  if (v.type === 'touch' && [0, 1, 2, 3].includes(Number(v.action)) && Number.isInteger(v.action)) {
    if (v.action === 3) return { type: 'touch', action: 3 };
    if (
      Array.isArray(v.pointers) &&
      v.pointers.length >= 1 &&
      v.pointers.length <= 10 &&
      Number.isInteger(v.id)
    ) {
      const points: TouchPoint[] = [];
      for (const p of v.pointers) {
        if (
          !p ||
          !Number.isInteger(p.id) ||
          p.id < 0 ||
          p.id > 31 ||
          !coordinate(p.x) ||
          !coordinate(p.y) ||
          points.some((q) => q.id === p.id)
        )
          throw Error(t('Pontos de toque inválidos', 'Invalid touch points'));
        points.push({ id: p.id, x: p.x, y: p.y });
      }
      if (!points.some((p) => p.id === v.id))
        throw Error(t('Ponto alterado ausente', 'Changed touch point is missing'));
      return { type: 'touch', action: Number(v.action), id: Number(v.id), pointers: points };
    }
    if (coordinate(v.x) && coordinate(v.y))
      return { type: 'touch', action: Number(v.action), x: v.x, y: v.y };
  }
  throw Error(t('Controle inválido', 'Invalid control'));
}

export function controlPacket(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(validateControl(value)), 'utf8');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
}
