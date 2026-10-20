package com.mirrorpanel.companion;

import android.media.*;
import android.media.projection.MediaProjection;
import android.os.Handler;
import android.os.Looper;
import java.nio.ByteBuffer;

/** Public playback capture with explicit MediaProjection consent; never records the microphone. */
final class PlaybackAudio {

    interface Sink {
        void packet(int flags, long pts, byte[] data) throws Exception;
        void state(String state, String message);
    }

    private final MediaProjection projection;
    private final Sink sink;
    private volatile boolean stopped;
    private volatile AudioRecord recorder;
    private final MediaProjection.Callback callback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            stop();
        }
    };

    PlaybackAudio(MediaProjection projection, Sink sink) {
        this.projection = projection;
        this.sink = sink;
        projection.registerCallback(callback, new Handler(Looper.getMainLooper()));
    }

    void start() {
        new Thread(this::capture, "mirrorpanel-playback-audio").start();
    }

    void stop() {
        stopped = true;
        AudioRecord current = recorder;
        if (current != null) try {
            current.stop();
        } catch (IllegalStateException ignored) {}
    }

    private void capture() {
        MediaCodec codec = null;
        AudioRecord audio = null;
        boolean codecStarted = false;
        try {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
            AudioFormat format = new AudioFormat.Builder()
                .setSampleRate(48000)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build();
            int minimum = AudioRecord.getMinBufferSize(
                48000,
                AudioFormat.CHANNEL_IN_STEREO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            if (minimum <= 0) throw new IllegalStateException("Formato de áudio indisponível");
            AudioPlaybackCaptureConfiguration capture = new AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build();
            audio = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(Math.max(minimum * 4, 16384))
                .setAudioPlaybackCaptureConfig(capture)
                .build();
            recorder = audio;
            if (stopped) return;
            if (audio.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException(
                "Captura de áudio indisponível"
            );
            codec = MediaCodec.createEncoderByType("audio/mp4a-latm");
            MediaFormat encoded = MediaFormat.createAudioFormat("audio/mp4a-latm", 48000, 2);
            encoded.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            encoded.setInteger(MediaFormat.KEY_BIT_RATE, 128000);
            encoded.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 4096);
            codec.configure(encoded, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            codec.start();
            codecStarted = true;
            audio.startRecording();
            sink.state("started", "Áudio de mídia • 48 kHz estéreo");
            long frames = 0,
                base = -1;
            byte[] pcm = new byte[4096];
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            AudioTimestamp stamp = new AudioTimestamp();
            while (!stopped) {
                // Drain before waiting for another input buffer; no unbounded queue.
                int output;
                while ((output = codec.dequeueOutputBuffer(info, 0)) != MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        ByteBuffer config = codec.getOutputFormat().getByteBuffer("csd-0");
                        if (config != null) {
                            byte[] bytes = new byte[config.remaining()];
                            config.get(bytes);
                            sink.packet(2, 0, bytes);
                        }
                    } else if (output >= 0) {
                        try {
                            ByteBuffer data = codec.getOutputBuffer(output);
                            if (data != null && info.size > 0) {
                                data.position(info.offset);
                                data.limit(info.offset + info.size);
                                byte[] bytes = new byte[info.size];
                                data.get(bytes);
                                sink.packet(
                                    (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0 ? 2 : 0,
                                    Math.max(0, info.presentationTimeUs),
                                    bytes
                                );
                            }
                        } finally {
                            codec.releaseOutputBuffer(output, false);
                        }
                    }
                }
                int input = codec.dequeueInputBuffer(10000);
                if (input < 0) continue;
                ByteBuffer buffer = codec.getInputBuffer(input);
                if (buffer == null) throw new IllegalStateException("Buffer AAC indisponível");
                int count = audio.read(
                    pcm,
                    0,
                    (Math.min(pcm.length, buffer.capacity()) / 4) * 4,
                    AudioRecord.READ_BLOCKING
                );
                if (stopped) break;
                if (count <= 0 || count % 4 != 0) throw new IllegalStateException("Leitura de áudio falhou: " + count);
                if (base < 0) {
                    base =
                        audio.getTimestamp(stamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS
                            ? stamp.nanoTime / 1000 - (stamp.framePosition * 1000000) / 48000
                            : System.nanoTime() / 1000 - ((count / 4) * 1000000L) / 48000;
                }
                buffer.clear();
                buffer.put(pcm, 0, count);
                codec.queueInputBuffer(input, 0, count, base + (frames * 1000000) / 48000, 0);
                frames += count / 4;
            }
        } catch (Exception error) {
            if (!stopped) sink.state("error", "Não foi possível capturar áudio: " + error.getClass().getSimpleName());
        } finally {
            stopped = true;
            recorder = null;
            if (audio != null) {
                try {
                    audio.stop();
                } catch (IllegalStateException ignored) {}
                audio.release();
            }
            if (codec != null) {
                if (codecStarted) try {
                    codec.stop();
                } catch (IllegalStateException ignored) {}
                codec.release();
            }
            projection.unregisterCallback(callback);
            projection.stop();
            sink.state("off", "Áudio desligado");
        }
    }
}
