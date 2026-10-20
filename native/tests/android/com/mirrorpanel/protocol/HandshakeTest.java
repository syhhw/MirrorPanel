package com.mirrorpanel.protocol;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public final class HandshakeTest {

    private static final String TOKEN = "00112233445566778899aabbccddeeff0123456789abcdeffedcba9876543210";

    public static void main(String[] args) throws IOException {
        for (String reason : new String[] { Handshake.BUSY, Handshake.NO_INDICATOR }) {
            ByteArrayOutputStream sent = new ByteArrayOutputStream();
            Handshake.refuse(new DataOutputStream(sent), TOKEN, reason);
            DataInputStream server = new DataInputStream(new ByteArrayInputStream(sent.toByteArray()));
            byte[] token = new byte[32];
            server.readFully(token);
            check(Arrays.equals(token, Handshake.token(TOKEN)), "Refusal must authenticate like a session");
            check(reason.equals(Handshake.refusal(server)), "Server must read the reason " + reason);
        }
        check(!Handshake.BUSY.equals(Handshake.NO_INDICATOR), "Reasons must be distinguishable");
        check(Handshake.token(TOKEN)[0] == 0x00 && Handshake.token(TOKEN)[31] == 0x10, "Hex token decoded wrongly");

        // An accepted session authenticates the same way and answers with a heartbeat.
        ByteArrayOutputStream accepted = new ByteArrayOutputStream();
        Handshake.accept(new DataOutputStream(accepted), TOKEN);
        DataInputStream server = input(accepted);
        byte[] token = new byte[32];
        server.readFully(token);
        check(Arrays.equals(token, Handshake.token(TOKEN)), "Acceptance must authenticate");
        check(Handshake.refusal(server) == null, "Heartbeat must confirm the indicator");
        check(server.read() == -1, "Acceptance must be exactly the token and one heartbeat");

        rejects(frame(5, "{\"kind\":\"heartbeat\"}"), "Status before the answer");
        rejects(frame(4, "Companion ocupado"), "Free text reason");
        rejects(frame(4, ""), "Empty reason");
        rejects(frame(4, "a-very-long-reason-that-goes-on-and-on-past-the-sixty-four-byte-limit"), "Long reason");
        System.out.println(
            "HANDSHAKE_OK: busy and indicator refusals, heartbeat acceptance, malformed answers rejected"
        );
    }

    private static ByteArrayOutputStream frame(int type, String text) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Wire.write(new DataOutputStream(bytes), type, 0, 0, text.getBytes(StandardCharsets.UTF_8));
        return bytes;
    }

    private static DataInputStream input(ByteArrayOutputStream bytes) {
        return new DataInputStream(new ByteArrayInputStream(bytes.toByteArray()));
    }

    private static void rejects(ByteArrayOutputStream bytes, String message) {
        try {
            Handshake.refusal(input(bytes));
        } catch (IOException expected) {
            return;
        }
        throw new AssertionError(message + " accepted");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
