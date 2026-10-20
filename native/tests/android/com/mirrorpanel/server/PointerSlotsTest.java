package com.mirrorpanel.server;

public final class PointerSlotsTest {
    public static void main(String[] args) {
        PointerSlots slots = new PointerSlots();
        check(slots.add(3) == 0 && slots.add(9) == 1 && slots.add(17) == 2, "Sparse IDs must be remapped");
        slots.remove(9);
        check(slots.get(3) == 0 && slots.get(17) == 2, "Remaining IDs must not shift");
        check(slots.add(31) == 1, "Freed slot must be reusable");
        boolean duplicate = false;
        try { slots.add(17); } catch (IllegalArgumentException expected) { duplicate = true; }
        check(duplicate, "Duplicate ID accepted");
        slots.clear();
        for (int id = 31; id >= 22; id--) check(slots.add(id) == 31 - id, "Native ID outside 0..9");
        boolean overflow = false;
        try { slots.add(0); } catch (IllegalArgumentException expected) { overflow = true; }
        check(overflow && slots.get(22) == 9, "Capacity failure changed live pointers");
        slots.clear();check(slots.add(17) == 0, "Cancel did not reset allocation");
        System.out.println("POINTER_SLOTS_OK: sparse IDs, stable middle removal, reuse, duplicates, ten-contact bound, cancel");
    }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
