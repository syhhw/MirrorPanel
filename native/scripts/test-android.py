"""Run the Android pointer allocator and Companion handshake regressions on a real JVM, without mocks."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
java = Path(os.environ.get('JAVA_HOME', r'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot')) / 'bin'
out = root / 'build/android-tests'
out.mkdir(parents=True, exist_ok=True)
subprocess.run([str(java / 'javac.exe'), '-encoding', 'UTF-8', '-Xlint:all', '-d', str(out),
                str(root / 'android/server/src/com/mirrorpanel/server/PointerSlots.java'),
                str(root / 'android/common/src/com/mirrorpanel/protocol/Wire.java'),
                str(root / 'android/common/src/com/mirrorpanel/protocol/Handshake.java'),
                str(root / 'tests/android/com/mirrorpanel/server/PointerSlotsTest.java'),
                str(root / 'tests/android/com/mirrorpanel/protocol/HandshakeTest.java')], check=True)
for test in ('com.mirrorpanel.server.PointerSlotsTest', 'com.mirrorpanel.protocol.HandshakeTest'):
    subprocess.run([str(java / 'java.exe'), '-cp', str(out), test], check=True)
