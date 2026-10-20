package com.mirrorpanel.companion;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.projection.*;
import android.os.*;
import com.mirrorpanel.protocol.Wire;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

public final class SessionService extends Service {

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
        if (service != null) service.status("audio", "off", "Captura de áudio não autorizada");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if ("audio-start".equals(intent.getAction())) {
            if (!authorized(intent.getStringExtra("token"))) return START_NOT_STICKY;
            startAudio(intent);
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;
        int port = intent.getIntExtra("port", 0);
        token = intent.getStringExtra("token");
        if (port < 1 || port > 65535 || token == null || !token.matches("[a-f0-9]{64}")) {
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(
            new NotificationChannel("mirroring", "Espelhamento", NotificationManager.IMPORTANCE_LOW)
        );
        if (
            !manager.areNotificationsEnabled() ||
            manager.getNotificationChannel("mirroring").getImportance() == NotificationManager.IMPORTANCE_NONE
        ) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Intent details = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent action = PendingIntent.getActivity(
            this,
            0,
            details,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        notification = new Notification.Builder(this, "mirroring")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("MirrorPanel está espelhando esta tela")
            .setContentText("Conectado ao computador. Toque para ver os detalhes.")
            .setOngoing(true)
            .setContentIntent(action)
            .build();
        foreground(false);
        running = true;
        active = this;
        new Thread(() -> bridge(port), "mirrorpanel-companion").start();
        return START_NOT_STICKY;
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
            byte[] bytes = new byte[32];
            for (int i = 0; i < 32; i++) bytes[i] = (byte) Integer.parseInt(token.substring(i * 2, i * 2 + 2), 16);
            out.write(bytes);
            out.flush();
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
                        .put("message", ok ? "" : "Selecione um campo de texto no aparelho.")
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
            status("audio", "error", "Captura de áudio indisponível: " + error.getClass().getSimpleName());
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
        status("audio", "off", "Áudio desligado");
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
