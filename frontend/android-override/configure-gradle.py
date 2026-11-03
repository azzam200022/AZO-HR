#!/usr/bin/env python3
"""Configure versionCode and release signing for the generated Capacitor project."""
import os
import re
from pathlib import Path

manifest_file = Path("android/app/src/main/AndroidManifest.xml")
manifest = manifest_file.read_text(encoding="utf-8")
for permission in (
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
):
    declaration = f'<uses-permission android:name="{permission}"'
    if declaration not in manifest:
        if "</manifest>" not in manifest:
            raise SystemExit("Could not locate the closing Android manifest tag")
        manifest = manifest.replace(
            "</manifest>",
            f'    <uses-permission android:name="{permission}" />\n</manifest>',
            1,
        )
manifest_file.write_text(manifest, encoding="utf-8")

gradle_file = Path("android/app/build.gradle")
text = gradle_file.read_text(encoding="utf-8")
run_number = os.environ.get("GITHUB_RUN_NUMBER", "")
if not run_number.isdigit() or int(run_number) < 1:
    raise SystemExit("GITHUB_RUN_NUMBER must be a positive integer")

text, code_count = re.subn(
    r"(?m)^(\s*versionCode)\s+1\s*$",
    lambda match: f"{match.group(1)} {run_number}",
    text,
    count=1,
)
if code_count != 1:
    raise SystemExit("Could not set Android versionCode in app/build.gradle")

ref = os.environ.get("GITHUB_REF", "")
ref_name = os.environ.get("GITHUB_REF_NAME", "")
if ref.startswith("refs/tags/v"):
    version_name = re.sub(r"[^A-Za-z0-9._+-]", "-", ref_name)
else:
    version_name = f"0.0.{run_number}"
text, name_count = re.subn(
    r'(?m)^(\s*versionName)\s+"[^"]+"\s*$',
    lambda match: f'{match.group(1)} "{version_name}"',
    text,
    count=1,
)
if name_count != 1:
    raise SystemExit("Could not set Android versionName in app/build.gradle")

needle = "    buildTypes {\n        release {\n"
replacement = """    signingConfigs {
        release {
            storeFile = file(System.getenv("ANDROID_KEYSTORE_FILE") ?: "release-keystore.jks")
            storePassword = (System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "")
            keyAlias = (System.getenv("ANDROID_KEY_ALIAS") ?: "")
            keyPassword = (System.getenv("ANDROID_KEY_PASSWORD") ?: "")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
"""
if needle not in text:
    raise SystemExit("Could not locate the Android release build type")
text = text.replace(needle, replacement, 1)
gradle_file.write_text(text, encoding="utf-8")
print(f"Configured Android versionCode={run_number}, versionName={version_name}")
