package com.mirrorpanel.server;

import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import org.json.*;
import java.util.*;

/** Keeps Android pointer IDs stable while array indices change. */
final class TouchController {
    interface Sink { void send(MotionEvent event) throws Exception; }
    private final Sink sink;
    private final LinkedHashMap<Integer, float[]> points = new LinkedHashMap<>();
    private final PointerSlots slots = new PointerSlots();
    private long downTime;
    TouchController(Sink sink) { this.sink = sink; }
    synchronized void accept(JSONObject message, int width, int height) throws Exception {
        int action = message.getInt("action");
        if (action == 3) { cancel(); return; }
        int changed = message.optInt("id", 0);
        JSONArray list = message.optJSONArray("pointers");
        if (list == null) list = new JSONArray().put(new JSONObject().put("id", 0).put("x", message.getDouble("x")).put("y", message.getDouble("y")));
        LinkedHashMap<Integer, float[]> next = new LinkedHashMap<>();
        if (list.length() < 1 || list.length() > 10 || width < 1 || height < 1) throw new IllegalArgumentException("Invalid pointers");
        for (int i = 0; i < list.length(); i++) {
            JSONObject p = list.getJSONObject(i); int id = p.getInt("id");
            double x = p.getDouble("x"), y = p.getDouble("y");
            if (id < 0 || id > 31 || next.containsKey(id) || !Double.isFinite(x) || !Double.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)
                throw new IllegalArgumentException("Invalid pointer");
            next.put(id, new float[]{(float)(x * (width - 1)), (float)(y * (height - 1))});
        }
        int androidAction;
        if (action == 0) {
            Set<Integer> expected = new HashSet<>(points.keySet()); expected.add(changed);
            if (points.containsKey(changed) || !expected.equals(next.keySet())) throw new IllegalArgumentException("Invalid down");
            if (points.isEmpty()) downTime = SystemClock.uptimeMillis();
            androidAction = points.isEmpty() ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_POINTER_DOWN;
            slots.add(changed);
        } else if (action == 1 || action == 2) {
            if (!points.keySet().equals(next.keySet()) || !points.containsKey(changed)) throw new IllegalArgumentException("Invalid active pointers");
            androidAction = action == 2 ? MotionEvent.ACTION_MOVE : points.size() == 1 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_POINTER_UP;
        } else throw new IllegalArgumentException("Invalid touch action");
        points.clear(); points.putAll(next);
        try { emit(androidAction, changed); }
        catch (Exception error) { try { cancel(); } catch (Exception ignored) { } throw error; }
        if (action == 1) { points.remove(changed); slots.remove(changed); }
    }
    synchronized void cancel() throws Exception {
        if (points.isEmpty()) return;
        try { emit(MotionEvent.ACTION_CANCEL, points.keySet().iterator().next()); } finally { points.clear(); slots.clear(); }
    }
    private void emit(int action, int changed) throws Exception {
        MotionEvent.PointerProperties[] props = new MotionEvent.PointerProperties[points.size()];
        MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[points.size()];
        int index = 0, changedIndex = 0;
        for (Map.Entry<Integer, float[]> entry : points.entrySet()) {
            props[index] = new MotionEvent.PointerProperties(); props[index].id = slots.get(entry.getKey()); props[index].toolType = MotionEvent.TOOL_TYPE_FINGER;
            coords[index] = new MotionEvent.PointerCoords(); coords[index].x = entry.getValue()[0]; coords[index].y = entry.getValue()[1];
            coords[index].pressure = 1; coords[index].size = 1;
            if (entry.getKey() == changed) changedIndex = index;
            index++;
        }
        if (action == MotionEvent.ACTION_POINTER_DOWN || action == MotionEvent.ACTION_POINTER_UP) action |= changedIndex << MotionEvent.ACTION_POINTER_INDEX_SHIFT;
        MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, props.length, props, coords, 0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        try { sink.send(event); } finally { event.recycle(); }
    }
}
