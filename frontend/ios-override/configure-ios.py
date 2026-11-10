from pathlib import Path
import plistlib


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "ios" / "App" / "App"
INFO_PLIST = APP_DIR / "Info.plist"
PROJECT = ROOT / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"

with INFO_PLIST.open("rb") as source:
    info = plistlib.load(source)

info["NSLocationWhenInUseUsageDescription"] = (
    "يستخدم مواردي موقعك لتسجيل الحضور والتحقق من موقع العمل. "
    "لا يبدأ التتبع الخلفي إلا بعد موافقتك."
)
info["NSLocationAlwaysAndWhenInUseUsageDescription"] = (
    "يستخدم مواردي موقعك أثناء الدوام لتسجيل الحضور والتحقق من وجودك ضمن موقع العمل، "
    "حتى عند انتقال التطبيق إلى الخلفية."
)
info["NSLocationAlwaysUsageDescription"] = (
    "يستخدم مواردي موقعك أثناء الدوام لتسجيل الحضور والتحقق من موقع العمل."
)
info["UIBackgroundModes"] = sorted(set(info.get("UIBackgroundModes", [])) | {"location"})

with INFO_PLIST.open("wb") as destination:
    plistlib.dump(info, destination, sort_keys=False)

google_service_plist = APP_DIR / "GoogleService-Info.plist"
if google_service_plist.exists():
    with google_service_plist.open("rb") as source:
        firebase_config = plistlib.load(source)
    if firebase_config.get("BUNDLE_ID") != "com.azzam200022.azo":
        raise SystemExit("GoogleService-Info.plist must use bundle ID com.azzam200022.azo")

    project_text = PROJECT.read_text()
    file_ref_id = "A20F4B813E2D4C5A9B7D10C5"
    build_file_id = "A20F4B813E2D4C5A9B7D10C4"
    if "GoogleService-Info.plist" not in project_text:
        project_text = project_text.replace(
            "/* End PBXBuildFile section */",
            f'\t\t{build_file_id} /* GoogleService-Info.plist in Resources */ = '
            f'{{isa = PBXBuildFile; fileRef = {file_ref_id} /* GoogleService-Info.plist */; }};\n'
            "/* End PBXBuildFile section */",
            1,
        )
        project_text = project_text.replace(
            "/* End PBXFileReference section */",
            f'\t\t{file_ref_id} /* GoogleService-Info.plist */ = '
            '{isa = PBXFileReference; lastKnownFileType = text.plist.xml; '
            'path = "GoogleService-Info.plist"; sourceTree = "<group>"; };\n'
            "/* End PBXFileReference section */",
            1,
        )
        project_text = project_text.replace(
            "A20F4B813E2D4C5A9B7D10C3 /* App.entitlements */,",
            "A20F4B813E2D4C5A9B7D10C3 /* App.entitlements */,\n"
            f"\t\t\t\t{file_ref_id} /* GoogleService-Info.plist */,",
            1,
        )
        updated_project_text = project_text.replace(
            "50B271D11FEDC1A000F3C39B /* public in Resources */,",
            "50B271D11FEDC1A000F3C39B /* public in Resources */,\n"
            f"\t\t\t\t{build_file_id} /* GoogleService-Info.plist in Resources */,",
            1,
        )
        if updated_project_text == project_text:
            raise SystemExit("Could not add GoogleService-Info.plist to the iOS resources phase")
        PROJECT.write_text(updated_project_text)
