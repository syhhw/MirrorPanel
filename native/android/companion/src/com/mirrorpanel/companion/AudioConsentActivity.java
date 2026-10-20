package com.mirrorpanel.companion;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;

/** The system dialog grants playback capture for this session only. */
@SuppressWarnings("deprecation")
public final class AudioConsentActivity extends Activity {
    private String token;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); token = getIntent().getStringExtra("token");
        if (!SessionService.authorized(token)) { finish(); return; }
        if (state != null) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 1);
        else requestCapture();
    }
    private void requestCapture() { startActivityForResult(getSystemService(MediaProjectionManager.class).createScreenCaptureIntent(), 2); }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) requestCapture();
        else { SessionService.audioDeclined(); finish(); }
    }
    @Override public void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 2 && result == RESULT_OK && data != null && SessionService.authorized(token))
            startForegroundService(new Intent(this, SessionService.class).setAction("audio-start").putExtra("projection", data).putExtra("token", token));
        else SessionService.audioDeclined();
        finish();
    }
}
