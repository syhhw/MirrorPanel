package com.mirrorpanel.server;

import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Build;
import android.os.IBinder;
import android.view.Surface;

/** Shell display adapter: Android 10–13 SurfaceControl, Android 14+ DisplayManager. */
final class DisplayCapture implements AutoCloseable {
    private VirtualDisplay display;
    private IBinder token;
    private Class<?> control;
    static DisplayCapture open(Surface surface, int width, int height, int sourceWidth, int sourceHeight, int layerStack) throws Exception {
        DisplayCapture result = new DisplayCapture();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                result.display = (VirtualDisplay) DisplayManager.class.getMethod("createVirtualDisplay",
                    String.class, int.class, int.class, int.class, Surface.class)
                    .invoke(null, "MirrorPanel", width, height, 0, surface);
                if (result.display == null) throw new IllegalStateException("Display mirroring unavailable");
            } else {
                result.control = Class.forName("android.view.SurfaceControl");
                result.token = (IBinder) result.control.getMethod("createDisplay", String.class, boolean.class)
                    .invoke(null, "MirrorPanel", false);
                Class<?> transaction = Class.forName("android.view.SurfaceControl$Transaction");
                Object tx = transaction.getConstructor().newInstance();
                try {
                    transaction.getMethod("setDisplaySurface", IBinder.class, Surface.class).invoke(tx, result.token, surface);
                    transaction.getMethod("setDisplayProjection", IBinder.class, int.class, Rect.class, Rect.class)
                        .invoke(tx, result.token, 0, new Rect(0, 0, sourceWidth, sourceHeight), new Rect(0, 0, width, height));
                    transaction.getMethod("setDisplayLayerStack", IBinder.class, int.class).invoke(tx, result.token, layerStack);
                    transaction.getMethod("apply").invoke(tx);
                } finally { transaction.getMethod("close").invoke(tx); }
            }
            return result;
        } catch (Exception error) { result.close(); throw error; }
    }
    @Override public void close() {
        if (display != null) { display.release(); display = null; }
        if (token != null) {
            try { control.getMethod("destroyDisplay", IBinder.class).invoke(null, token); }
            catch (ReflectiveOperationException ignored) { }
            token = null;
        }
    }
}
