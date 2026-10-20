package com.mirrorpanel.server;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputEvent;
import android.view.KeyEvent;
import android.view.Surface;
import com.mirrorpanel.protocol.Wire;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

/** Original MirrorPanel protocol. Runs only under an authorized ADB shell. */
@SuppressWarnings({ "deprecation", "try" }) // Shell APIs; watchdog intentionally closes accept().
public final class Main {

    private static final byte[] HEARTBEAT = "{\"kind\":\"heartbeat\"}".getBytes(StandardCharsets.UTF_8);
    private volatile boolean running = true;
    private volatile MediaCodec encoder;
    private volatile DataOutputStream streamOut;
    private LocalSocket client;
    private Object displays;
    private Object inputs;
    private Method inject;
    private int sourceWidth, sourceHeight, rotation;
    private TouchController touches;
    private volatile DataOutputStream companionOut;

    public static void main(String[] args) {
        try {
            if (android.os.Process.myUid() != 2000) throw new SecurityException("ADB shell required");
            if (args.length != 4 || !args[0].matches("mp_[a-f0-9]{32}")) throw new IllegalArgumentException(
                "Invalid session arguments"
            );
            Looper.prepareMainLooper();
            new Main().run(args);
        } catch (Throwable e) {
            e.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private void run(String[] args) throws Exception {
        int maxSize = bounded(args[1], 320, 3840);
        int fps = bounded(args[2], 5, 120);
        int bitrate = bounded(args[3], 100000, 50000000);
        DataInputStream stdin = new DataInputStream(System.in);
        // ASCII bootstrap avoids terminal control bytes in ADB shell transports.
        byte[] bootstrap = new byte[128];
        stdin.readFully(bootstrap);
        byte[] token = hexToken(bootstrap, 0),
            noticeToken = hexToken(bootstrap, 64);
        Class<?> serviceManager = Class.forName("android.os.ServiceManager");
        IBinder displayBinder = (IBinder) serviceManager.getMethod("getService", String.class).invoke(null, "display");
        displays = Class.forName("android.hardware.display.IDisplayManager$Stub")
            .getMethod("asInterface", IBinder.class)
            .invoke(null, displayBinder);
        Class<?> inputClass;
        try {
            inputClass = Class.forName("android.hardware.input.InputManagerGlobal");
        } catch (ClassNotFoundException e) {
            inputClass = Class.forName("android.hardware.input.InputManager");
        }
        inputs = inputClass.getMethod("getInstance").invoke(null);
        inject = inputClass.getMethod("injectInputEvent", InputEvent.class, int.class);
        touches = new TouchController(event -> inject.invoke(inputs, event, 0));

        try (
            LocalServerSocket listener = new LocalServerSocket(args[0]);
            ServerSocket notice = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        ) {
            notice.setSoTimeout(20000);
            System.out.println("MIRRORPANEL_READY " + notice.getLocalPort());
            System.out.flush();
            Socket indicator = acceptNotice(notice, noticeToken);
            companionOut = new DataOutputStream(indicator.getOutputStream());
            Thread watchdog = new Thread(() -> {
                try (Socket socket = indicator) {
                    socket.setSoTimeout(5000);
                    DataInputStream in = new DataInputStream(socket.getInputStream());
                    while (running) {
                        Wire.Frame frame = Wire.read(in, 131072);
                        if (frame.type == 6) {
                            Wire.write(companionOut, 6, 0, 0, new byte[0]);
                            // A static display may produce no video frames. Carry the
                            // authenticated Companion liveness through to the PC too.
                            DataOutputStream out = streamOut;
                            if (out != null) Wire.write(out, 5, 0, 0, HEARTBEAT);
                        } else if (frame.type == 3 || frame.type == 5) {
                            DataOutputStream out = streamOut;
                            if (out != null) Wire.write(out, frame.type, frame.flags, frame.pts, frame.data);
                        } else throw new IOException("Unexpected Companion packet");
                    }
                } catch (Exception error) {
                    if (running) System.err.println("COMPANION_CLOSED " + error.getClass().getSimpleName());
                }
                companionLost();
            }, "indicator-watchdog");
            watchdog.setDaemon(true);
            watchdog.start();
            // Closing the listener unblocks accept when the phone stops the session.
            Thread acceptGuard = new Thread(() -> {
                while (running) SystemClock.sleep(100);
                try {
                    listener.close();
                } catch (IOException ignored) {}
            });
            acceptGuard.setDaemon(true);
            acceptGuard.start();
            long connectDeadline = SystemClock.uptimeMillis() + 20000;
            Thread expiry = new Thread(() -> {
                while (running && client == null && SystemClock.uptimeMillis() < connectDeadline)
                    SystemClock.sleep(100);
                if (client == null) stop();
            });
            expiry.setDaemon(true);
            expiry.start();
            while (running) {
                LocalSocket candidate = listener.accept();
                try {
                    candidate.setSoTimeout(3000);
                    byte[] supplied = new byte[32];
                    new DataInputStream(candidate.getInputStream()).readFully(supplied);
                    if (!MessageDigest.isEqual(token, supplied)) {
                        candidate.close();
                        continue;
                    }
                    candidate.setSoTimeout(0);
                    client = candidate;
                    break;
                } catch (IOException e) {
                    candidate.close();
                }
            }
            if (client == null) return;
            Thread controls = new Thread(this::controls, "control");
            controls.setDaemon(true);
            controls.start();
            try {
                DataOutputStream out = new DataOutputStream(client.getOutputStream());
                streamOut = out;
                while (running) capture(out, maxSize, fps, bitrate);
            } catch (IOException e) {
                if (running) throw e;
            } finally {
                stop();
                indicator.close();
            }
        } finally {
            stop();
        }
    }

    private Socket acceptNotice(ServerSocket server, byte[] token) throws IOException {
        long deadline = SystemClock.uptimeMillis() + 20000;
        while (SystemClock.uptimeMillis() < deadline) {
            Socket socket = server.accept();
            try {
                socket.setSoTimeout(1500);
                byte[] value = new byte[32];
                new DataInputStream(socket.getInputStream()).readFully(value);
                if (MessageDigest.isEqual(value, token)) return socket;
            } catch (IOException ignored) {}
            socket.close();
        }
        throw new IOException("Companion indicator did not connect");
    }

    private int[] dimensions() throws Exception {
        Object info = displays.getClass().getMethod("getDisplayInfo", int.class).invoke(displays, 0);
        Class<?> type = info.getClass();
        return new int[] {
            type.getField("logicalWidth").getInt(info),
            type.getField("logicalHeight").getInt(info),
            type.getField("rotation").getInt(info),
            type.getField("layerStack").getInt(info),
        };
    }

    private void capture(DataOutputStream out, int maxSize, int fps, int bitrate) throws Exception {
        touches.cancel();
        int[] size = dimensions();
        sourceWidth = size[0];
        sourceHeight = size[1];
        rotation = size[2];
        double scale = Math.min(1.0, (double) maxSize / Math.max(sourceWidth, sourceHeight));
        int width = Math.max(8, ((int) (sourceWidth * scale) / 8) * 8);
        int height = Math.max(8, ((int) (sourceHeight * scale) / 8) * 8);
        MediaCodec codec = MediaCodec.createEncoderByType("video/avc");
        Surface surface = null;
        DisplayCapture display = null;
        boolean started = false;
        try {
            MediaFormat format = MediaFormat.createVideoFormat("video/avc", width, height);
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            format.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
            format.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
            format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
            // OMX codecs require a matching level when a profile is forced. Let the
            // encoder select a supported profile/level; the receiver reads the SPS.
            format.setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0);
            format.setFloat("max-fps-to-encoder", fps);
            format.setLong("repeat-previous-frame-after", 100000);
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            surface = codec.createInputSurface();
            display = DisplayCapture.open(surface, width, height, sourceWidth, sourceHeight, size[3]);
            codec.start();
            started = true;
            encoder = codec;
            JSONObject metadata = new JSONObject()
                .put("width", width)
                .put("height", height)
                .put("sourceWidth", sourceWidth)
                .put("sourceHeight", sourceHeight)
                .put("rotation", rotation)
                .put("codec", "h264")
                .put("audio", true);
            packet(out, 1, 0, 0, metadata.toString().getBytes(StandardCharsets.UTF_8));
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long nextSizeCheck = SystemClock.uptimeMillis() + 500;
            while (running) {
                int index = codec.dequeueOutputBuffer(info, 100000);
                if (index >= 0) {
                    try {
                        ByteBuffer bytes = codec.getOutputBuffer(index);
                        if (bytes != null && info.size > 0) {
                            bytes.position(info.offset);
                            bytes.limit(info.offset + info.size);
                            byte[] payload = new byte[info.size];
                            bytes.get(payload);
                            int flags =
                                ((info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0 ? 1 : 0) |
                                ((info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0 ? 2 : 0);
                            packet(out, 2, flags, info.presentationTimeUs, payload);
                        }
                    } finally {
                        codec.releaseOutputBuffer(index, false);
                    }
                }
                if (SystemClock.uptimeMillis() >= nextSizeCheck) {
                    int[] current = dimensions();
                    if (current[0] != sourceWidth || current[1] != sourceHeight || current[2] != rotation) break;
                    nextSizeCheck = SystemClock.uptimeMillis() + 500;
                }
            }
        } finally {
            encoder = null;
            if (display != null) display.close();
            if (started) codec.stop();
            codec.release();
            if (surface != null) surface.release();
        }
    }

    private static void packet(DataOutputStream out, int type, int flags, long pts, byte[] payload) throws IOException {
        synchronized (out) {
            out.writeInt(0x4d505631);
            out.writeByte(type);
            out.writeByte(flags);
            out.writeShort(0);
            out.writeInt(payload.length);
            out.writeLong(pts);
            out.write(payload);
            out.flush();
        }
    }

    private void controls() {
        try {
            DataInputStream in = new DataInputStream(client.getInputStream());
            while (running) {
                int count = in.readInt();
                if (count < 2 || count > 131072) throw new IOException("Invalid control size");
                byte[] bytes = new byte[count];
                in.readFully(bytes);
                JSONObject message = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                String type = message.getString("type");
                if (type.equals("stop")) break;
                try {
                    if (type.equals("touch")) touches.accept(message, sourceWidth, sourceHeight);
                    else if (type.equals("key")) key(message.getInt("code"));
                    else if (type.equals("text") || type.equals("ime-restore") || type.equals("audio-stop")) {
                        if (
                            type.equals("text") &&
                            message.getString("text").getBytes(StandardCharsets.UTF_8).length > 65536
                        ) throw new IllegalArgumentException("Text too long");
                        Wire.write(companionOut, 7, 0, 0, message.toString().getBytes(StandardCharsets.UTF_8));
                    } else if (type.equals("sync")) {
                        MediaCodec current = encoder;
                        if (current != null) {
                            Bundle bundle = new Bundle();
                            bundle.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0);
                            current.setParameters(bundle);
                        }
                    }
                } catch (Exception e) {
                    System.err.println("CONTROL_ERROR " + e);
                }
            }
        } catch (Exception e) {
            if (running) System.err.println("CONTROL_CLOSED " + e.getClass().getSimpleName());
        } finally {
            stop();
        }
    }

    private void key(int code) throws Exception {
        if (code < 0 || code > 400) throw new IllegalArgumentException("Invalid keycode");
        long now = SystemClock.uptimeMillis();
        inject.invoke(inputs, new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0), 0);
        inject.invoke(inputs, new KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0), 0);
    }

    private void stop() {
        running = false;
        if (touches != null) try {
            touches.cancel();
        } catch (Exception ignored) {}
        LocalSocket socket = client;
        if (socket != null) try {
            socket.close();
        } catch (IOException ignored) {}
    }

    private void companionLost() {
        if (!running) return;
        running = false;
        DataOutputStream out = streamOut;
        if (out != null) try {
            packet(out, 4, 0, 0, "companion-lost".getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {}
        stop();
    }

    private static int bounded(String value, int low, int high) {
        int number = Integer.parseInt(value);
        if (number < low || number > high) throw new IllegalArgumentException("Value out of range");
        return number;
    }

    private static byte[] hexToken(byte[] input, int start) {
        byte[] value = new byte[32];
        for (int i = 0; i < 32; i++) {
            int a = Character.digit((char) input[start + i * 2], 16);
            int b = Character.digit((char) input[start + i * 2 + 1], 16);
            if (a < 0 || b < 0) throw new IllegalArgumentException("Invalid bootstrap token");
            value[i] = (byte) ((a << 4) | b);
        }
        return value;
    }
}
