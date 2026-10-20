"""Build the local-only synthetic device test fixture; never package it."""
import importlib.util
from pathlib import Path
import zipfile
spec = importlib.util.spec_from_file_location('android_build', Path(__file__).with_name('build-android.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
dex = b.compile_dex('fixture')
unsigned = b.BUILD / 'fixture-unsigned.apk'
aligned = b.BUILD / 'fixture-aligned.apk'
b.run(b.TOOLS / 'aapt2.exe', 'link', '-o', unsigned, '--manifest', b.ROOT / 'android/fixture/AndroidManifest.xml', '-I', b.PLATFORM)
with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as apk:
    apk.write(dex, 'classes.dex')
b.run(b.TOOLS / 'zipalign.exe', '-f', '4', unsigned, aligned)
b.run(b.java_tool('java'), '-jar', b.TOOLS / 'lib/apksigner.jar', 'sign', '--ks', b.BUILD / 'development.keystore', '--ks-pass', 'pass:android', '--ks-key-alias', 'mirrorpanel', '--out', b.BUILD / 'fixture.apk', aligned)
print('Synthetic fixture built; excluded from package')
