#!/bin/bash
# Builds JARVIS.apk without Gradle. Needs JAVA_HOME and ANDROID_SDK (build-tools 34, platform 34).
set -e
cd "$(dirname "$0")"; BT=$ANDROID_SDK/build-tools/34.0.0; JAR=$ANDROID_SDK/platforms/android-34/android.jar
rm -rf out && mkdir -p out/res out/classes out/dex
$BT/aapt2 compile --dir res -o out/res.zip
$BT/aapt2 link -o out/base.apk -I $JAR --manifest AndroidManifest.xml out/res.zip
$JAVA_HOME/bin/javac -source 8 -target 8 -bootclasspath $JAR -classpath $JAR -d out/classes $(find src -name '*.java')
$BT/d8 --min-api 24 --lib $JAR --output out/dex $(find out/classes -name '*.class')
cp out/base.apk out/unsigned.apk && (cd out/dex && zip -q ../unsigned.apk classes.dex)
$BT/zipalign -f 4 out/unsigned.apk out/aligned.apk
: "${JARVIS_KEYSTORE:?Provide a private signing keystore path}"
: "${JARVIS_STORE_PASSWORD:?Provide the private keystore password}"
$BT/apksigner sign --ks "$JARVIS_KEYSTORE" --ks-pass env:JARVIS_STORE_PASSWORD --out out/JARVIS.apk out/aligned.apk
$BT/apksigner verify out/JARVIS.apk && echo BUILT
