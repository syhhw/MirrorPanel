package com.mirrorpanel.companion;

import android.app.*;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.projection.*;
import android.os.*;
import com.mirrorpanel.protocol.Handshake;
import com.mirrorpanel.protocol.Wire;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

public final class SessionService extends Service {

    private static final String CHANNEL = "mirroring";
    private static volatile SessionService active;
    private volatile Socket connection;
    private volatile DataOutputStream output;
    private volatile boolean running;
    private String token;
    private Notification notification;
    private PlaybackAudio audio;
    private long audioGeneration;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicInteger pendingCommands = new AtomicInteger();
    private final ThreadPoolExecutor replies = new ThreadPoolExecutor(
        1,
        1,
        0L,
        TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(128),
        task -> new Thread(task, "mirrorpanel-replies")
    );

    static boolean isRunning() {
        SessionService service = active;
        return service != null && service.running;
    }

    static boolean authorized(String candidate) {
        SessionService service = active;
        return (
            service != null &&
            service.running &&
            candidate != null &&
            service.token != null &&
            MessageDigest.isEqual(
                candidate.getBytes(StandardCharsets.US_ASCII),
                service.token.getBytes(StandardCharsets.US_ASCII)
            )
        );
    }

    static void audioDeclined() {
        SessionService service = active;
        if (service != null) service.status("audio", "off", "Audio capture not authorized");
    }

    static boolean validToken(String candidate) {
        return candidate != null && candidate.matches("[a-f0-9]{64}");
    }

    /** The visible notification is the user's indicator; without it no session may start. */
    static boolean indicatorAllowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(
            new NotificationChannel(
                CHANNEL,
                context.getString(R.string.notification_channel),
                NotificationManager.IMPORTANCE_LOW
            )
        );
        return (
            manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(CHANNEL).getImportance() != NotificationManager.IMPORTANCE_NONE
        );
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        indicatorAllowed(this);
        Intent details = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent action = PendingIntent.getActivity(
            this,
            0,
            details,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setOngoing(true)
            .setContentIntent(action)
            .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int id) {
        // Every start comes from startForegroundService. Android kills the whole app if the service
        // stops before calling startForeground, so it runs first, even for requests that are rejected.
        foreground(audio != null);
        if (intent == null) {
            stopIfIdle();
            return START_NOT_STICKY;
        }
        if ("audio-start".equals(intent.getAction())) {
            if (authorized(intent.getStringExtra(ConnectActivity.EXTRA_TOKEN))) startAudio(intent);
            else stopIfIdle();
            return START_NOT_STICKY;
        }
        int port = intent.getIntExtra(ConnectActivity.EXTRA_PORT, 0);
        String candidate = intent.getStringExtra(ConnectActivity.EXTRA_TOKEN);
        if (port < 1 || port > 65535 || !validToken(candidate)) {
            stopIfIdle();
            return START_NOT_STICKY;
        }
        // One session at a time. A new request is refused instead of taking over: two desktops would
        // fight over the keyboard, audio consent and this notification, and a second MirrorPanel or a
        // test profile could end a mirror someone is using. The refusal says why to the new desktop.
        if (running) {
            refuse(port, candidate, Handshake.BUSY);
            return START_NOT_STICKY;
        }
        if (!indicatorAllowed(this)) {
            refuse(port, candidate, Handshake.NO_INDICATOR);
            stopIfIdle();
            return START_NOT_STICKY;
        }
        token = candidate;
        running = true;
        active = this;
        new Thread(() -> bridge(port), "mirrorpanel-companion").start();
        return START_NOT_STICKY;
    }

    /**
     * Answers a valid request that will not start on its server's indicator socket, so the desktop
     * learns the reason at once instead of waiting for an indicator that never comes.
     */
    static void refuse(int port, String token, String reason) {
        android.util.Log.i("MirrorPanel", "SESSION_REFUSED " + reason);
        new Thread(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", port), 4000);
                Handshake.refuse(new DataOutputStream(socket.getOutputStream()), token, reason);
            } catch (IOException error) {
                android.util.Log.w("MirrorPanel", "REFUSAL_UNDELIVERED " + error.getClass().getSimpleName());
            }
        }, "mirrorpanel-refusal").start();
    }

    /** Rejected requests must not end a session that is already running. */
    private void stopIfIdle() {
        if (running) return;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void foreground(boolean capturing) {
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        if (capturing) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        startForeground(73, notification, type);
    }

    private void bridge(int port) {
        try (Socket socket = new Socket()) {
            connection = socket;
            socket.connect(new InetSocketAddress("127.0.0.1", port), 4000);
            socket.setSoTimeout(5000);
            socket.setTcpNoDelay(true);
            DataOutputStream out = new DataOutputStream(socket.getOutputStream());
            // The answer comes before anything else on this socket: the server captures only after it.
            Handshake.accept(out, token);
            output = out;
            Thread heartbeat = new Thread(() -> {
                try {
                    while (running) {
                        Wire.write(out, 6, 0, 0, new byte[0]);
                        Thread.sleep(1000);
                    }
                } catch (Exception error) {
                    android.util.Log.w("MirrorPanel", "HEARTBEAT_CLOSED " + error.getClass().getSimpleName());
                    stopSelf();
                }
            }, "mirrorpanel-heartbeat");
            heartbeat.setDaemon(true);
            heartbeat.start();
            DataInputStream in = new DataInputStream(socket.getInputStream());
            while (running) {
                Wire.Frame frame = Wire.read(in, 131072);
                if (frame.type == 6) continue;
                if (frame.type != 7) throw new IOException("Unexpected command");
                JSONObject command = new JSONObject(new String(frame.data, StandardCharsets.UTF_8));
                if (pendingCommands.incrementAndGet() > 128) throw new IOException("Command queue full");
                main.post(() -> {
                    try {
                        command(command);
                    } finally {
                        pendingCommands.decrementAndGet();
                    }
                });
            }
        } catch (Exception error) {
            android.util.Log.w("MirrorPanel", "BRIDGE_CLOSED " + error.getClass().getSimpleName());
        } finally {
            stopSelf();
        }
    }

    private void command(JSONObject command) {
        if (!running) return;
        try {
            String type = command.getString("type");
            if (type.equals("text")) {
                String text = command.getString("text");
                boolean ok = text.getBytes(StandardCharsets.UTF_8).length <= 65536 && MirrorInput.commit(text);
                send(
                    new JSONObject()
                        .put("kind", "text")
                        .put("id", command.getInt("id"))
                        .put("ok", ok)
                        .put("message", ok ? "" : "Select a text field on the device.")
                );
            } else if (type.equals("ime-restore")) MirrorInput.previous = command.getString("previous");
            else if (type.equals("audio-stop")) stopAudio();
        } catch (Exception error) {
            android.util.Log.w("MirrorPanel", "Command failed: " + error.getClass().getSimpleName());
        }
    }

    private void send(JSONObject value) {
        DataOutputStream out = output;
        if (out == null || !running) return;
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        try {
            replies.execute(() -> {
                try {
                    Wire.write(out, 5, 0, 0, bytes);
                } catch (IOException ignored) {
                    stopSelf();
                }
            });
        } catch (RejectedExecutionException ignored) {
            stopSelf();
        }
    }

    private void status(String kind, String state, String message) {
        try {
            send(new JSONObject().put("kind", kind).put("state", state).put("message", message));
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void startAudio(Intent intent) {
        if (audio != null) return;
        try {
            Intent result = intent.getParcelableExtra("projection");
            if (result == null) throw new IllegalArgumentException("Missing consent");
            foreground(true);
            MediaProjection projection = getSystemService(MediaProjectionManager.class).getMediaProjection(
                Activity.RESULT_OK,
                result
            );
            long generation = ++audioGeneration;
            audio = new PlaybackAudio(
                projection,
                new PlaybackAudio.Sink() {
                    public void packet(int flags, long pts, byte[] data) throws Exception {
                        DataOutputStream out = output;
                        if (!running || generation != audioGeneration || out == null) throw new IOException(
                            "Session closed"
                        );
                        Wire.write(out, 3, flags, pts, data);
                    }

                    public void state(String state, String message) {
                        main.post(() -> {
                            if (!running || generation != audioGeneration) return;
                            status("audio", state, message);
                            if (state.equals("off")) {
                                audio = null;
                                foreground(false);
                            }
                        });
                    }
                }
            );
            audio.start();
        } catch (Exception error) {
            status("audio", "error", "Audio capture unavailable: " + error.getClass().getSimpleName());
            foreground(false);
        }
    }

    private void stopAudio() {
        ++audioGeneration;
        if (audio != null) {
            audio.stop();
            audio = null;
        }
        foreground(false);
        status("audio", "off", "Audio off");
    }

    @Override
    public void onDestroy() {
        android.util.Log.i("MirrorPanel", "SERVICE_DESTROYED");
        running = false;
        if (active == this) active = null;
        ++audioGeneration;
        if (audio != null) audio.stop();
        try {
            if (connection != null) connection.close();
        } catch (IOException ignored) {}
        MirrorInput.restore();
        token = null;
        output = null;
        replies.shutdownNow();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
