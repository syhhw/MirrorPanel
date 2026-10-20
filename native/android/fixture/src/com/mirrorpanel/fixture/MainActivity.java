package com.mirrorpanel.fixture;

import android.app.Activity;
import android.media.*;
import android.os.Bundle;
import android.text.*;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Synthetic test data only. This debug APK is excluded from the product. */
public final class MainActivity extends Activity {

    private AudioTrack tone;
    private final JSONArray events = new JSONArray();

    private void save(String name, String data) {
        try (FileOutputStream out = openFileOutput(name, MODE_PRIVATE)) {
            out.write(data.getBytes(StandardCharsets.UTF_8));
        } catch (IOException error) {
            throw new IllegalStateException(error);
        }
    }

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(1);
        layout.setPadding(24, 40, 24, 24);
        TextView title = new TextView(this);
        title.setText("MirrorPanel • verificação real");
        title.setTextSize(24);
        layout.addView(title);
        EditText editor = new EditText(this);
        editor.setHint("Unicode");
        editor.setSingleLine(false);
        editor.setMinLines(3);
        editor.setTextSize(20);
        layout.addView(editor);
        editor.addTextChangedListener(
            new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int a, int c, int f) {}

                public void onTextChanged(CharSequence s, int a, int b, int c) {
                    save("text.txt", s.toString());
                }

                public void afterTextChanged(Editable e) {}
            }
        );
        Button clear = new Button(this);
        clear.setText("Limpar teste");
        clear.setOnClickListener(v -> {
            editor.setText("");
            editor.requestFocus();
            events.length();
            save("touch.json", "[]");
        });
        layout.addView(clear);
        Button sound = new Button(this);
        sound.setText("Tom de teste 440 Hz");
        sound.setOnClickListener(v -> {
            if (tone == null) startTone();
            else stopTone();
        });
        layout.addView(sound);
        TextView pad = new TextView(this);
        pad.setText("Área de multitoque\nToque, arraste e teste Alt+clique");
        pad.setTextSize(22);
        pad.setGravity(Gravity.CENTER);
        pad.setBackgroundColor(0xffdbeafe);
        layout.addView(pad, new LinearLayout.LayoutParams(-1, 0, 1));
        pad.setOnTouchListener((v, e) -> {
            try {
                JSONObject row = new JSONObject().put("action", e.getActionMasked()).put("index", e.getActionIndex());
                JSONArray pointers = new JSONArray();
                for (int i = 0; i < e.getPointerCount(); i++) pointers.put(
                    new JSONObject().put("id", e.getPointerId(i)).put("x", e.getX(i)).put("y", e.getY(i))
                );
                row.put("pointers", pointers);
                events.put(row);
                save("touch.json", events.toString());
                pad.setText("Pontos: " + e.getPointerCount() + " • ação: " + e.getActionMasked());
            } catch (JSONException error) {
                throw new IllegalStateException(error);
            }
            return true;
        });
        setContentView(layout);
        save("text.txt", "");
        save("touch.json", "[]");
        if (getIntent().getBooleanExtra("readonly", false)) {
            editor.setEnabled(false);
            layout.setFocusableInTouchMode(true);
            layout.requestFocus();
        } else editor.requestFocus();
        if (getIntent().getBooleanExtra("tone", false)) startTone();
    }

    private void startTone() {
        short[] pcm = new short[48000 * 2];
        for (int n = 0; n < 48000; n++) pcm[n * 2] = pcm[n * 2 + 1] = (short) (Math.sin(
            (n * 2 * Math.PI * 440) / 48000
        ) * 6000);
        tone = new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_ALL)
                    .build()
            )
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setSampleRate(48000)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.length * 2)
            .build();
        tone.write(pcm, 0, pcm.length);
        tone.setLoopPoints(0, 48000, -1);
        tone.play();
    }

    private void stopTone() {
        if (tone != null) {
            tone.stop();
            tone.release();
            tone = null;
        }
    }

    @Override
    public void onDestroy() {
        stopTone();
        super.onDestroy();
    }
}
