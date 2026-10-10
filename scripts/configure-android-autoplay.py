#!/usr/bin/env python3
"""Allow the bundled audio track to autoplay inside the installed Capacitor app."""

from pathlib import Path
import re
import sys

activity_root = Path("android/app/src/main/java")
activities = list(activity_root.rglob("MainActivity.java")) if activity_root.is_dir() else []
if len(activities) != 1:
    raise SystemExit(f"Expected one generated MainActivity.java, found {len(activities)}.")

activity = activities[0]
source = activity.read_text(encoding="utf-8")
if "setMediaPlaybackRequiresUserGesture(false)" in source:
    print(f"Autoplay already configured in {activity}.")
    raise SystemExit(0)

pattern = re.compile(r"public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}")
replacement = """public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        allowBundledAudioAutoplay();
    }

    @Override
    public void onStart() {
        super.onStart();
        allowBundledAudioAutoplay();
    }

    private void allowBundledAudioAutoplay() {
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}"""
if not pattern.search(source):
    raise SystemExit(f"Generated MainActivity shape not recognized: {activity}")

source = pattern.sub(replacement, source, count=1)
if "import android.os.Bundle;" not in source:
    package = re.search(r"(?m)^package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*;", source)
    if not package:
        raise SystemExit(f"Package declaration not found in {activity}")
    source = source[: package.end()] + "\n\nimport android.os.Bundle;" + source[package.end() :]
activity.write_text(source, encoding="utf-8")
print(f"Configured Android WebView audio autoplay in {activity}.")
