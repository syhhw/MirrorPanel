package com.mirrorpanel.companion;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import com.mirrorpanel.protocol.Handshake;

/**
 * Entry point the desktop opens over ADB to start a session.
 *
 * <p>The manifest protects it with INJECT_EVENTS, a signature permission that the ADB shell holds and
 * ordinary apps cannot get. Without that, any installed app could point the Companion at its own
 * loopback server, trigger the audio consent dialog under MirrorPanel's name and block real sessions.
 */
public final class ConnectActivity extends Activity {

    static final String EXTRA_PORT = "port";
    static final String EXTRA_TOKEN = "token";

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        int port = getIntent().getIntExtra(EXTRA_PORT, 0);
        String token = getIntent().getStringExtra(EXTRA_TOKEN);
        if (port > 0 && port < 65536 && SessionService.validToken(token)) {
            // A running session answers first, so a busy phone is never reported as notifications off.
            if (SessionService.isRunning() || SessionService.indicatorAllowed(this)) {
                startForegroundService(
                    new Intent(this, SessionService.class).putExtra(EXTRA_PORT, port).putExtra(EXTRA_TOKEN, token)
                );
            } else {
                SessionService.refuse(port, token, Handshake.NO_INDICATOR);
                startActivity(
                    new Intent(this, MainActivity.class)
                        .putExtra(MainActivity.EXTRA_INDICATOR_BLOCKED, true)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                );
            }
        }
        finish();
    }
}
