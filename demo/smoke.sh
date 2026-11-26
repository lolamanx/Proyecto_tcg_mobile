set -eu
adb install -g demo/build/outputs/apk/debug/*.apk
adb shell am start -W -n cl.cardfolio.demo/.Scanner
for attempt in {1..12}; do
  adb shell uiautomator dump /sdcard/demo.xml >/dev/null || true
  adb shell cat /sdcard/demo.xml > pantalla.xml || true
  if grep -q 'Escáner de cartas' pantalla.xml && grep -qi 'Mis lecturas' pantalla.xml; then
    adb exec-out screencap -p > inicio.png
    exit 0
  fi
  sleep 2
done
adb logcat -d -s AndroidRuntime:E
exit 1
