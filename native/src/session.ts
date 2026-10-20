import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Adb } from './adb';
import { PacketReader, Packet, VideoInfo, parseInfo, controlPacket, validText } from './protocol';
import { Recording } from './recording';

export interface Quality {
  maxSize: number;
  fps: number;
  bitrate: number;
}
export const DEFAULT_QUALITY: Quality = { maxSize: 1920, fps: 60, bitrate: 8000000 };
export function quality(value: unknown): Quality {
  const q = value as Quality;
  if (
    !q ||
    ![720, 1080, 1280, 1920, 2560, 3840].includes(q.maxSize) ||
    ![15, 24, 30, 60, 90, 120].includes(q.fps) ||
    !Number.isInteger(q.bitrate) ||
    q.bitrate < 500000 ||
    q.bitrate > 50000000
  )
    throw Error('Qualidade inválida');
  return { maxSize: q.maxSize, fps: q.fps, bitrate: q.bitrate };
}
export type SessionState = 'starting' | 'mirroring' | 'stopping' | 'stopped';

/** Owns only its child process, forward and remote temporary JAR. Never kills ADB. */
export class MirrorSession extends EventEmitter {
  state: SessionState = 'starting';
  info?: VideoInfo;
  config?: Buffer;
  recording?: Recording;
  audioConfig?: Buffer;
  audioState = 'off';
  private noticeToken = '';
  private previousIme?: string;
  private imeSetup?: Promise<void>;
  private imeWasEnabled = false;
  private readonly ime = 'com.mirrorpanel.companion/.MirrorInput';
  private textId = 0;
  private pendingText = new Map<
    number,
    { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private child?: ChildProcessWithoutNullStreams;
  private socket?: Socket;
  private port?: number;
  private remote: string;
  private name = 'mp_' + randomBytes(16).toString('hex');
  private stopping = false;
  private cleanupPromise?: Promise<void>;
  private done = false;
  private videoPackets = 0;
  private heartbeats = 0;
  private lastPacketAt = 0;
  stats(): Record<string, unknown> {
    return {
      state: this.state,
      videoPackets: this.videoPackets,
      heartbeats: this.heartbeats,
      lastPacketAt: this.lastPacketAt,
      childPid: this.child?.pid,
    };
  }
  private reader = new PacketReader();
  constructor(
    readonly serial: string,
    readonly settings: Quality,
    private adb: Adb,
    private resources: string,
  ) {
    super();
    this.remote = '/data/local/tmp/' + this.name + '.jar';
  }
  private checkpoint(): void {
    if (this.stopping) throw Error('Sessão cancelada');
  }
  async start(): Promise<void> {
    try {
      const api = Number(await this.adb.shell(this.serial, ['getprop', 'ro.build.version.sdk']));
      if (api < 29) throw Error('Este motor requer Android 10 ou mais recente.');
      this.checkpoint();
      await this.adb.device(
        this.serial,
        ['push', join(this.resources, 'mirrorpanel-server.jar'), this.remote],
        30000,
      );
      this.checkpoint();
      await this.adb.device(
        this.serial,
        ['install', '-r', '-g', join(this.resources, 'mirrorpanel-companion.apk')],
        60000,
      );
      this.checkpoint();
      const token = randomBytes(32),
        noticeToken = randomBytes(32);
      this.noticeToken = noticeToken.toString('hex');
      const child = this.adb.launch(
        this.serial,
        this.remote,
        this.name,
        this.settings.maxSize,
        this.settings.fps,
        this.settings.bitrate,
      );
      this.child = child;
      child.stdin.on('error', () => {});
      const noticePort = await new Promise<number>((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(
          () => reject(Error('O servidor Android não iniciou em 15 segundos.')),
          15000,
        );
        child.once('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(Error('Servidor Android encerrou: ' + code));
        });
        child.stdout.on('data', (data: Buffer) => {
          output = (output + data.toString()).slice(-8192);
          const match = output.match(/MIRRORPANEL_READY (\d+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(Number(match[1]));
          }
        });
        child.stderr.on('data', (data: Buffer) => this.emit('log', data.toString().slice(0, 4096)));
        child.stdin.write(token.toString('hex') + noticeToken.toString('hex'), 'ascii');
      });
      child.once('exit', (code, signal) => {
        this.emit('diagnostic', 'child-exit', { code, signal, stopping: this.stopping });
        if (!this.stopping) void this.end('process-exit');
      });
      this.checkpoint();
      this.port = Number(
        await this.adb.device(this.serial, ['forward', 'tcp:0', 'localabstract:' + this.name]),
      );
      if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535)
        throw Error('ADB retornou uma porta inválida');
      this.checkpoint();
      // Separate token authenticates the visible Companion and its audio/IME bridge.
      await this.adb.shell(
        this.serial,
        [
          'am',
          'start',
          '-W',
          '-n',
          'com.mirrorpanel.companion/.MainActivity',
          '--ei',
          'port',
          String(noticePort),
          '--es',
          'token',
          noticeToken.toString('hex'),
        ],
        20000,
      );
      this.checkpoint();
      await new Promise<void>((resolve, reject) => {
        const socket = new Socket();
        this.socket = socket;
        const timeout = setTimeout(
          () =>
            reject(
              Error(
                'O Companion não confirmou o indicador de espelhamento. Verifique as notificações no Android.',
              ),
            ),
          15000,
        );
        this.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.setNoDelay(true);
        socket.setTimeout(15000);
        socket.once('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        });
        socket.on('error', (e) => {
          if (!this.stopping) this.emit('log', e.message);
        });
        socket.on('timeout', () => {
          clearTimeout(timeout);
          reject(Error('Vídeo sem resposta'));
          void this.end('timeout');
        });
        socket.once('close', (hadError) => {
          this.emit('diagnostic', 'socket-close', { hadError, stopping: this.stopping });
          clearTimeout(timeout);
          reject(Error('Conexão de vídeo encerrada'));
          if (!this.stopping) void this.end('stream-ended');
        });
        socket.on('data', (data: Buffer) => {
          try {
            for (const packet of this.reader.feed(data)) this.handle(packet);
          } catch (e) {
            this.emit('log', String(e));
            void this.end('protocol-error');
          }
        });
        socket.connect(this.port!, '127.0.0.1', () => socket.write(token));
      });
      this.checkpoint();
      this.imeSetup = this.enableIme();
      await this.imeSetup;
      this.checkpoint();
      this.state = 'mirroring';
      this.emit('state', this.state);
    } catch (error) {
      await this.end('start-failed');
      throw error;
    } finally {
      // An ADB operation can finish after Stop was clicked during startup.
      // Sweep late allocations as well as those known when cleanup began.
      if (this.stopping) {
        this.socket?.destroy();
        if (this.child?.exitCode === null) this.child.kill();
        if (this.port)
          await this.adb
            .device(this.serial, ['forward', '--remove', 'tcp:' + this.port], 4000)
            .catch(() => {});
        await this.adb.shell(this.serial, ['rm', '-f', this.remote], 4000).catch(() => {});
        await this.restoreIme();
      }
    }
  }
  private handle(packet: Packet): void {
    if (this.stopping) return;
    this.lastPacketAt = Date.now();
    if (packet.type === 2) this.videoPackets++;
    if (packet.type === 4) {
      const reason = packet.data.toString('utf8');
      void this.end(
        reason === 'companion-lost'
          ? 'companion-lost'
          : reason === 'phone-stop'
            ? 'phone-stop'
            : 'protocol-error',
      );
      return;
    }
    if (packet.type === 5) {
      const status = JSON.parse(packet.data.toString('utf8')) as {
        kind: string;
        id: number;
        ok: boolean;
        message: string;
        state: string;
      };
      if (status.kind === 'text') {
        const pending = this.pendingText.get(status.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingText.delete(status.id);
          if (status.ok) pending.resolve();
          else pending.reject(Error(status.message || 'Texto não inserido'));
        }
      } else if (status.kind === 'heartbeat') {
        this.heartbeats++;
        this.notify('heartbeat');
      } else if (status.kind === 'audio' && ['off', 'started', 'error'].includes(status.state)) {
        this.audioState = status.state;
        if (status.state !== 'started') {
          this.audioConfig = undefined;
          if (this.recording) this.stopRecordingSafely();
        }
        this.notify('audio-state', { state: status.state, message: status.message });
      }
      return;
    }
    if (packet.type === 3) {
      if (packet.flags & 2) this.audioConfig = packet.data;
      if (this.recording)
        try {
          this.recording.addAudio(packet);
        } catch (e) {
          this.stopRecordingSafely();
          this.notify('log', 'Falha ao gravar áudio: ' + String(e));
        }
      this.notify('audio', packet);
      return;
    }
    if (packet.type === 1) {
      if (this.recording) {
        this.stopRecordingSafely();
        this.notify(
          'log',
          'Gravação encerrada porque a tela girou. Inicie outra gravação para a nova orientação.',
        );
      }
      this.info = parseInfo(packet.data);
      this.config = undefined;
      this.notify('info', this.info);
    } else if (packet.type === 2) {
      if (packet.flags & 2) this.config = packet.data;
      if (this.info && this.config) this.notify('ready');
      if (this.recording) {
        try {
          this.recording.add(packet);
        } catch (e) {
          this.stopRecordingSafely();
          this.notify('log', 'Erro ao gravar: ' + String(e));
        }
      }
      this.notify('video', packet);
    }
  }
  /**
   * Emits a stream event to the app. A listener that throws is a desktop bug,
   * not a corrupt stream, so it is reported instead of ending the session as
   * protocol-error. Parsing errors in handle() still end the session.
   */
  private notify(event: string, ...args: unknown[]): void {
    try {
      this.emit(event, ...args);
    } catch (error) {
      try {
        this.emit('diagnostic', 'listener-error', { event, message: String(error) });
      } catch {
        /* Diagnostics are best effort and must not end the session either. */
      }
    }
  }
  /** Inside the stream handler a file error ends the recording, never the mirror. */
  private stopRecordingSafely(): void {
    try {
      this.stopRecording();
    } catch (e) {
      this.notify('log', 'Falha ao finalizar arquivo: ' + String(e));
    }
  }
  control(value: unknown): void {
    if ((value as { type?: string })?.type === 'text') {
      void this.text((value as { text: string }).text).catch((e) => this.emit('log', String(e)));
      return;
    }
    if (this.socket && !this.socket.destroyed) {
      if (this.socket.writableLength > 128 * 1024) throw Error('Fila de controle cheia');
      this.socket.write(controlPacket(value));
    }
  }
  private send(value: object): void {
    if (!this.socket || this.socket.destroyed || this.stopping) throw Error('Sessão encerrada');
    if (this.socket.writableLength > 128 * 1024) throw Error('Fila de controle cheia');
    const body = Buffer.from(JSON.stringify(value), 'utf8'),
      size = Buffer.alloc(4);
    size.writeUInt32BE(body.length);
    if (body.length > 131072) throw Error('Comando muito grande');
    this.socket.write(Buffer.concat([size, body]));
  }
  private async enableIme(): Promise<void> {
    this.previousIme = (
      await this.adb.shell(this.serial, ['settings', 'get', 'secure', 'default_input_method'])
    ).trim();
    this.imeWasEnabled = (await this.adb.shell(this.serial, ['ime', 'list', '-s']))
      .split(/\s+/)
      .includes(this.ime);
    this.checkpoint();
    this.send({ type: 'ime-restore', previous: this.previousIme });
    await this.adb.shell(this.serial, ['ime', 'enable', this.ime]);
    this.checkpoint();
    await this.adb.shell(this.serial, ['ime', 'set', this.ime]);
  }
  async text(text: string): Promise<void> {
    if (!validText(text)) throw Error('Texto inválido ou maior que 64 KiB');
    if (!text.length) return;
    if (this.pendingText.size >= 256) throw Error('Fila de texto cheia');
    const id = ++this.textId;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingText.delete(id);
        reject(Error('O aparelho não confirmou a entrada de texto'));
      }, 3000);
      this.pendingText.set(id, { resolve, reject, timer });
      try {
        this.send({ type: 'text', id, text });
      } catch (e) {
        clearTimeout(timer);
        this.pendingText.delete(id);
        reject(e);
      }
    });
  }
  async setAudio(enabled: boolean): Promise<void> {
    if (this.stopping) throw Error('Sessão encerrada');
    if (this.recording) this.stopRecording();
    if (!enabled) {
      this.send({ type: 'audio-stop' });
      return;
    }
    if (this.audioState === 'started') return;
    this.audioState = 'starting';
    this.emit('audio-state', {
      state: 'starting',
      message: 'Autorize a captura de áudio no aparelho.',
    });
    try {
      await this.adb.shell(
        this.serial,
        [
          'am',
          'start',
          '-W',
          '-n',
          'com.mirrorpanel.companion/.AudioConsentActivity',
          '--es',
          'token',
          this.noticeToken,
        ],
        20000,
      );
    } catch (error) {
      this.audioState = 'error';
      this.emit('audio-state', {
        state: 'error',
        message: 'Não foi possível abrir a autorização de áudio.',
      });
      throw error;
    }
  }
  private async restoreIme(): Promise<void> {
    if (this.previousIme === undefined) return;
    const previous = this.previousIme;
    this.previousIme = undefined;
    const current = (
      await this.adb
        .shell(this.serial, ['settings', 'get', 'secure', 'default_input_method'])
        .catch(() => '')
    ).trim();
    if (current === this.ime && previous && previous !== 'null' && previous !== this.ime)
      await this.adb.shell(this.serial, ['ime', 'set', previous]).catch(() => {});
    const after = (
      await this.adb
        .shell(this.serial, ['settings', 'get', 'secure', 'default_input_method'])
        .catch(() => '')
    ).trim();
    if (!this.imeWasEnabled && after !== this.ime)
      await this.adb.shell(this.serial, ['ime', 'disable', this.ime]).catch(() => {});
  }
  startRecording(path: string): void {
    if (this.recording) throw Error('Já existe uma gravação nesta sessão');
    if (!this.info || !this.config) throw Error('Aguarde o vídeo iniciar');
    if (this.audioState === 'started' && !this.audioConfig) throw Error('Aguarde o áudio iniciar');
    this.recording = new Recording(
      path,
      this.info,
      this.config,
      this.settings.fps,
      this.audioConfig,
    );
    this.control({ type: 'sync' });
    this.emit('recording', path);
  }
  stopRecording(): void {
    const recording = this.recording;
    this.recording = undefined;
    try {
      recording?.finish();
    } finally {
      this.notify('recording', null);
    }
  }
  async stop(source = 'api-stop'): Promise<void> {
    this.emit('diagnostic', 'stop-request', { source, alreadyStopping: this.stopping });
    await this.end('user-stop');
  }
  private async end(reason: string): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.emit('diagnostic', 'session-end-begin', { reason, ...this.stats() });
    this.stopping = true;
    this.state = 'stopping';
    this.cleanupPromise = (async () => {
      try {
        this.control({ type: 'stop' });
      } catch {
        /* Socket may already be gone. */
      }
      this.socket?.end();
      try {
        this.stopRecording();
      } catch (e) {
        this.emit('log', 'Falha ao finalizar arquivo: ' + String(e));
      }
      const child = this.child;
      if (child && child.exitCode === null) {
        await Promise.race([
          new Promise<void>((resolve) => child.once('exit', () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 1500)),
        ]);
        if (child.exitCode === null) child.kill();
      }
      this.socket?.destroy();
      for (const pending of this.pendingText.values()) {
        clearTimeout(pending.timer);
        pending.reject(Error('Sessão encerrada'));
      }
      this.pendingText.clear();
      await this.imeSetup?.catch(() => {});
      await this.restoreIme();
      this.noticeToken = '';
      try {
        this.reader.end();
      } catch (e) {
        this.emit('log', String(e));
      }
      if (this.port)
        await this.adb
          .device(this.serial, ['forward', '--remove', 'tcp:' + this.port], 4000)
          .catch(() => {});
      await this.adb.shell(this.serial, ['rm', '-f', this.remote], 4000).catch(() => {});
      this.state = 'stopped';
      if (!this.done) {
        this.done = true;
        this.emit('ended', reason);
      }
    })();
    return this.cleanupPromise;
  }
}
