"""Build original Java server and signed Companion APK with the Android SDK.

No Gradle or network download is used. Development signing key
stays in build/; set MIRRORPANEL_KEYSTORE and signing environment for releases.
"""
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
PLATFORM = SDK / "platforms/android-35/android.jar"
TOOLS = SDK / "build-tools/36.0.0"
JAVA = Path(os.environ.get("JAVA_HOME", r"C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot")) / "bin"
BUILD = ROOT / "build/android"
OUT = ROOT / "resources"


def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT)


def java_tool(name):
    return JAVA / (name + (".exe" if os.name == "nt" else ""))


def compile_dex(kind):
    source = ROOT / "android" / kind / "src"
    classes = BUILD / kind / "classes"
    dex = BUILD / kind / "dex"
    classes.mkdir(parents=True, exist_ok=True)
    dex.mkdir(parents=True, exist_ok=True)
    files = sorted(source.rglob("*.java")) + sorted((ROOT / "android/common/src").rglob("*.java"))
    run(java_tool("javac"), "-encoding", "UTF-8", "-source", "8", "-target", "8", "-Xlint:all,-options,-deprecation", "-cp", PLATFORM, "-d", classes, *files)
    archive = BUILD / kind / "classes.jar"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as jar:
        for file in classes.rglob("*.class"):
            jar.write(file, file.relative_to(classes).as_posix())
    run(java_tool("java"), "-cp", TOOLS / "lib/d8.jar", "com.android.tools.r8.D8", "--min-api", "29", "--lib", PLATFORM, "--output", dex, archive)
    return dex / "classes.dex"


def main():
    if not PLATFORM.is_file():
        raise SystemExit("Install SDK platform android-35 and build-tools 36.0.0; set ANDROID_HOME/JAVA_HOME.")
    OUT.mkdir(exist_ok=True)
    server = compile_dex("server")
    with zipfile.ZipFile(OUT / "mirrorpanel-server.jar", "w", zipfile.ZIP_DEFLATED) as jar:
        jar.write(server, "classes.dex")
    companion = compile_dex("companion")
    unsigned = BUILD / "companion-unsigned.apk"
    aligned = BUILD / "companion-aligned.apk"
    compiled = BUILD / "companion-res.zip"
    run(TOOLS / "aapt2.exe", "compile", "--dir", ROOT / "android/companion/res", "-o", compiled)
    run(TOOLS / "aapt2.exe", "link", "-o", unsigned, "--manifest", ROOT / "android/companion/AndroidManifest.xml", "-I", PLATFORM, compiled)
    with zipfile.ZipFile(unsigned, "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(companion, "classes.dex")
    run(TOOLS / "zipalign.exe", "-f", "4", unsigned, aligned)
    keystore = Path(os.environ.get("MIRRORPANEL_KEYSTORE", str(BUILD / "development.keystore")))
    password = os.environ.get("MIRRORPANEL_STORE_PASSWORD", "android")
    alias = os.environ.get("MIRRORPANEL_KEY_ALIAS", "mirrorpanel")
    if not keystore.exists():
        if "MIRRORPANEL_KEYSTORE" in os.environ:
            raise SystemExit("Release keystore does not exist")
        run(java_tool("keytool"), "-genkeypair", "-keystore", keystore, "-storepass", password, "-keypass", password,
            "-alias", alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=MirrorPanel Development")
    run(java_tool("java"), "-jar", TOOLS / "lib/apksigner.jar", "sign", "--ks", keystore, "--ks-pass", "pass:" + password,
        "--ks-key-alias", alias, "--out", OUT / "mirrorpanel-companion.apk", aligned)
    run(java_tool("java"), "-jar", TOOLS / "lib/apksigner.jar", "verify", "--verbose", OUT / "mirrorpanel-companion.apk")
    # Only official ADB transport files enter the application package.
    adb_dir = OUT / "adb"
    adb_dir.mkdir(exist_ok=True)
    for name in ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"):
        shutil.copy2(SDK / "platform-tools" / name, adb_dir / name)
    shutil.copy2(SDK / "platform-tools/NOTICE.txt", adb_dir / "NOTICE.txt")
    print("Android build OK: original server, signed Companion, official ADB")


if __name__ == "__main__":
    main()
