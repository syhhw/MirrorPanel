package com.mirrorpanel.protocol;

import java.io.*;
import java.nio.charset.StandardCharsets;

/**
 * How the Companion answers a session request on the server's indicator socket.
 *
 * <p>After the token it sends a heartbeat once it shows the indicator for that session, or an end
 * frame with a reason when it refuses: one session runs at a time and none runs without the visible
 * notification. The server passes the reason on so the desktop can say why instead of timing out.
 */
public final class Handshake {

    /** Another desktop's session is running on this phone. */
    public static final String BUSY = "companion-busy";
    /** The Companion's notifications are off, so the indicator cannot show. */
    public static final String NO_INDICATOR = "indicator-blocked";

    private Handshake() {}

    /** Companion side: authenticates with the hex token and confirms that the indicator is showing. */
    public static void accept(DataOutputStream out, String token) throws IOException {
        out.write(token(token));
        Wire.write(out, 6, 0, 0, new byte[0]);
    }

    /** Companion side: authenticates with the hex token, then refuses the session with a reason. */
    public static void refuse(DataOutputStream out, String token, String reason) throws IOException {
        out.write(token(token));
        Wire.write(out, 4, 0, 0, reason.getBytes(StandardCharsets.UTF_8));
    }

    /** Server side, after the token: null when the Companion confirmed the indicator, else its reason. */
    public static String refusal(DataInputStream in) throws IOException {
        Wire.Frame answer = Wire.read(in, 64);
        if (answer.type == 6) return null;
        String reason = new String(answer.data, StandardCharsets.UTF_8);
        if (answer.type != 4 || !reason.matches("[a-z-]{1,64}")) throw new IOException("Unexpected Companion answer");
        return reason;
    }

    /** The 32 bytes of a session token written as 64 hex characters. */
    public static byte[] token(String hex) {
        byte[] bytes = new byte[32];
        for (int i = 0; i < 32; i++) bytes[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return bytes;
    }
}
