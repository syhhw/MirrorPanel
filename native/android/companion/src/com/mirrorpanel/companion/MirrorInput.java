package com.mirrorpanel.companion;

import android.inputmethodservice.InputMethodService;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;

/** No editor contents are read or logged. Only the private session bridge can commit. */
public final class MirrorInput extends InputMethodService {

    private static MirrorInput active;
    private boolean editing;
    static String previous;

    @Override
    public void onCreate() {
        super.onCreate();
        active = this;
    }

    @Override
    public boolean onEvaluateInputViewShown() {
        return false;
    }

    @Override
    public boolean onEvaluateFullscreenMode() {
        return false;
    }

    @Override
    public void onStartInput(EditorInfo info, boolean restarting) {
        super.onStartInput(info, restarting);
        editing = info != null && info.inputType != android.text.InputType.TYPE_NULL;
    }

    @Override
    public void onFinishInput() {
        editing = false;
        super.onFinishInput();
    }

    @Override
    public void onDestroy() {
        if (active == this) active = null;
        super.onDestroy();
    }

    static boolean commit(String text) {
        if (active == null || !active.editing) return false;
        InputConnection connection = active.getCurrentInputConnection();
        return connection != null && connection.commitText(text, 1);
    }

    static void restore() {
        if (active != null && previous != null && !previous.isEmpty()) {
            try {
                active.switchInputMethod(previous);
            } catch (RuntimeException ignored) {}
        }
        previous = null;
    }
}
