/** Bounded live AAC decoder; AudioData is always closed after copying. */
export class AudioPlayer {
  private context?: AudioContext;
  private decoder?: AudioDecoder;
  private gain?: GainNode;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  decoded = 0;
  peak = 0;
  volume = 1;
  async activate(): Promise<void> {
    this.context ??= new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    if (!this.gain) {
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    this.gain.gain.value = this.volume;
    await this.context.resume();
  }
  configure(data: Uint8Array): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.clearSources();
    this.next = 0;
    this.decoder = new AudioDecoder({
      output: (frame) => {
        try {
          const context = this.context;
          if (!context || context.state !== 'running') return;
          const buffer = context.createBuffer(
            frame.numberOfChannels,
            frame.numberOfFrames,
            frame.sampleRate,
          );
          for (let channel = 0; channel < frame.numberOfChannels; channel++) {
            const samples = new Float32Array(frame.numberOfFrames);
            frame.copyTo(samples, { planeIndex: channel, format: 'f32-planar' });
            buffer.copyToChannel(samples, channel);
            for (const sample of samples) this.peak = Math.max(this.peak, Math.abs(sample));
          }
          this.decoded++;
          const now = context.currentTime;
          if (this.next < now || this.next > now + 0.25) this.next = now + 0.045;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(this.gain!);
          this.sources.add(source);
          source.onended = () => {
            source.disconnect();
            this.sources.delete(source);
          };
          source.start(this.next);
          this.next += buffer.duration;
        } finally {
          frame.close();
        }
      },
      error: (error) => this.onError(error.message),
    });
    this.decoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      description: new Uint8Array(data),
    });
  }
  constructor(private onError: (message: string) => void) {}
  decode(pts: number, data: Uint8Array): void {
    if (this.decoder?.state !== 'configured' || this.decoder.decodeQueueSize > 12) return;
    this.decoder.decode(
      new EncodedAudioChunk({ type: 'key', timestamp: pts, data: new Uint8Array(data) }),
    );
  }
  setVolume(value: number): void {
    this.volume = value;
    if (this.gain) this.gain.gain.value = value;
  }
  private clearSources(): void {
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
  }
  reset(): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = undefined;
    this.next = 0;
    this.clearSources();
    void this.context?.suspend();
  }
  close(): void {
    this.reset();
    void this.context?.close();
    this.context = undefined;
    this.gain = undefined;
  }
}
