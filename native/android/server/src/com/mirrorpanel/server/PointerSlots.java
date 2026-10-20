package com.mirrorpanel.server;

import java.util.HashMap;
import java.util.Map;

/** Transport IDs are independent of Android IDs. Keep native IDs below ten. */
final class PointerSlots {

    private final Map<Integer, Integer> slots = new HashMap<>();

    int add(int external) {
        if (slots.containsKey(external)) throw new IllegalArgumentException("Pointer already active");
        for (int slot = 0; slot < 10; slot++) {
            if (!slots.containsValue(slot)) {
                slots.put(external, slot);
                return slot;
            }
        }
        throw new IllegalArgumentException("Too many pointers");
    }

    int get(int external) {
        Integer slot = slots.get(external);
        if (slot == null) throw new IllegalArgumentException("Pointer not active");
        return slot;
    }

    void remove(int external) {
        slots.remove(external);
    }

    void clear() {
        slots.clear();
    }
}
