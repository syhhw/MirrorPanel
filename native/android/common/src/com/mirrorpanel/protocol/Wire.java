package com.mirrorpanel.protocol;

import java.io.*;

/** Bounded MPV1 frames shared by the authenticated Companion bridge. */
public final class Wire {

    private Wire() {}

    public static final class Frame {

        public int type, flags;
        public long pts;
        public byte[] data;
    }

    public static Frame read(DataInputStream in, int limit) throws IOException {
        if (in.readInt() != 0x4d505631) throw new IOException("Bad magic");
        Frame f = new Frame();
        f.type = in.readUnsignedByte();
        f.flags = in.readUnsignedByte();
        if (in.readUnsignedShort() != 0) throw new IOException("Bad reserved field");
        int size = in.readInt();
        f.pts = in.readLong();
        if (size < 0 || size > limit || f.pts < 0 || f.flags > 3) throw new IOException("Bad frame");
        f.data = new byte[size];
        in.readFully(f.data);
        return f;
    }

    public static void write(DataOutputStream out, int type, int flags, long pts, byte[] data) throws IOException {
        synchronized (out) {
            out.writeInt(0x4d505631);
            out.writeByte(type);
            out.writeByte(flags);
            out.writeShort(0);
            out.writeInt(data.length);
            out.writeLong(pts);
            out.write(data);
            out.flush();
        }
    }
}
