import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { usePathname, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useCardIndex } from '@/hooks/useCardIndex';
import { scanCard, type ScanStage } from '@/scan/pipeline';
import { cardGuideForView, guideToPhotoRect, type Rect, type Size } from '@/scan/geometry';
import { OcrUnavailableError, isOcrAvailable } from '@/scan/ocr';
import { setPendingScan } from '@/scan/store';
import { Body, Button, Caption, Heading, Meter, Muted, Title } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

/**
 * Capture screen. The frame is cropped to the guide rectangle and recognised
 * on device; nothing is uploaded. The result goes to the confirm screen, where
 * the user picks the right printing.
 */
export default function ScanScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const { status, syncing, progress, error: syncError, sync } = useCardIndex();

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const setScanStage = useCallback((next: ScanStage) => setStage(STAGE_LABELS[next]), []);
  const [scanError, setScanError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  // Measured preview size, and the card-shaped guide derived from it. Both the
  // overlay and the crop come from this one rectangle, so they cannot drift.
  const [viewSize, setViewSize] = useState<Size | null>(null);
  const guideRect: Rect | null = viewSize ? cardGuideForView(viewSize) : null;

  const ocrAvailable = isOcrAvailable();
  const indexReady = status?.ready ?? false;

  const focused = usePathname() === '/';
  const active = useRef(false);
  const visible = useRef(focused);
  visible.current = focused;
  const capture = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || busy || active.current || !visible.current) return;
    active.current = true;

    setBusy(true);
    setScanError(null);
    setStage('Capturing…');

    try {
      const photo = await camera.takePictureAsync({ quality: 0.95 });
      if (!photo?.uri) throw new Error('The camera returned no image.');

      // The preview covers the view by cropping the photo, so the on-screen
      // guide has to be projected back into photo space.
      const guide =
        guideRect && viewSize && photo.width && photo.height
          ? guideToPhotoRect({
              guide: guideRect,
              view: viewSize,
              photo: { width: photo.width, height: photo.height },
            })
          : undefined;

      let outcome = await scanCard(db, photo.uri, { fullFrame:true, artMatching:false, onStage:setScanStage });
      if (guide && outcome.match.confidence < 0.78 && visible.current) {
        const closer = await scanCard(db,photo.uri,{guide,onStage:setScanStage});
        if (closer.match.confidence > outcome.match.confidence) outcome = closer;
      }
      if (!visible.current) return;

      if (outcome.match.candidates.length === 0) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setScanError(
          outcome.ocr.text.trim().length === 0
            ? 'No text was readable. Try more light, less glare, and fill the frame with the card.'
            : 'Read the card but found no match in the index. Try again, or search by name.'
        );
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPendingScan(outcome);
      router.push('/scan/confirm');
    } catch (cause) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanError(
        cause instanceof OcrUnavailableError || cause instanceof Error
          ? cause.message
          : 'Something went wrong while scanning.'
      );
    } finally {
      active.current = false;
      setBusy(false);
      setStage(null);
    }
  }, [busy, db, guideRect, router, setScanStage, viewSize]);

  useEffect(()=>{
    if (!focused || !cameraReady || !indexReady || busy || !permission?.granted) return;
    const timer=setTimeout(()=>void capture(),1800);
    return ()=>clearTimeout(timer);
  },[focused,cameraReady,indexReady,busy,permission?.granted,capture]);

  // ---- Gates -------------------------------------------------------------

  if (!permission) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }

  if (!permission.granted) {
    return (
      <Centered>
        <Ionicons name="camera-outline" size={44} color={colors.textFaint} />
        <Title style={styles.centeredTitle}>Camera access needed</Title>
        <Muted style={styles.centeredText}>
          PK Scan reads the name and number printed on your card. The photo is processed on this
          device and never leaves it.
        </Muted>
        <Button label="Permitir cámara" onPress={requestPermission} />
      </Centered>
    );
  }

  if (!ocrAvailable) {
    return (
      <Centered>
        <Ionicons name="hardware-chip-outline" size={44} color={colors.textFaint} />
        <Title style={styles.centeredTitle}>Scanning needs a dev build</Title>
        <Muted style={styles.centeredText}>
          On-device text recognition is a native module, so it is unavailable in Expo Go and on the
          web. Run <Body style={styles.code}>npx expo run:android</Body> (or{' '}
          <Body style={styles.code}>run:ios</Body>) once, and scanning works from then on.
        </Muted>
        <Button
          label="Add cards by search instead"
          variant="secondary"
          onPress={() => router.push('/search')}
        />
      </Centered>
    );
  }

  if (!indexReady) {
    return (
      <Centered>
        <Ionicons name="cloud-download-outline" size={44} color={colors.textFaint} />
        <Title style={styles.centeredTitle}>Preparando el catálogo local</Title>
        <Muted style={styles.centeredText}>
          PK Scan downloads the TCGdex catalogue once — around 24,000 cards, 2.4 MB — so scans are
          matched on device with no round trip.
        </Muted>
        {syncing ? (
          <View style={styles.syncBlock}>
            <Meter value={progress?.progress ?? 0} />
            <Caption>{progress?.message ?? 'Starting…'}</Caption>
          </View>
        ) : (
          <>
            {syncError ? <Muted style={styles.error}>{syncError}</Muted> : null}
            <Button label="Descargar catálogo" onPress={sync} />
          </>
        )}
      </Centered>
    );
  }

  // ---- Camera ------------------------------------------------------------

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setViewSize((current) =>
          current && current.width === width && current.height === height ? current : { width, height }
        );
      }}
    >
      <CameraView
        ref={cameraRef}
        style={styles.fill}
        facing="back"
        enableTorch={torch}
        autofocus="on"
        onCameraReady={() => setCameraReady(true)}
      />

      <GuideOverlay rect={guideRect} />

      <View style={[styles.controls, { paddingTop: insets.top + spacing.md }]} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <Heading style={styles.headerText}>Muestra una carta para escanear</Heading>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
            onPress={() => setTorch((on) => !on)}
            style={styles.torch}
          >
            <Ionicons
              name={torch ? 'flashlight' : 'flashlight-outline'}
              size={20}
              color={torch ? colors.accent : colors.text}
            />
          </Pressable>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {scanError ? (
            <ScrollView style={styles.errorBox} contentContainerStyle={styles.errorBoxInner}>
              <Muted style={styles.error}>{scanError}</Muted>
            </ScrollView>
          ) : (
            <Caption style={styles.hint}>
              {stage ?? 'Mantén visibles el nombre y el número'}
            </Caption>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan card"
            accessibilityState={{ disabled: busy || !cameraReady, busy }}
            onPress={capture}
            disabled={busy || !cameraReady}
            style={({ pressed }) => [
              styles.shutter,
              pressed && styles.shutterPressed,
              (busy || !cameraReady) && styles.shutterDisabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Ionicons name="scan" size={28} color={colors.onAccent} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Draws the exact rectangle that will be cropped — card-shaped, so a tightly
 *  framed card fills it and the art descriptor sees what TCGdex saw. */
function GuideOverlay({ rect }: { rect: Rect | null }) {
  if (!rect) return null;
  return (
    <View style={styles.fill} pointerEvents="none">
      <View
        style={[
          styles.guide,
          { position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height },
        ]}
      >
        <View style={[styles.corner, styles.cornerTopLeft]} />
        <View style={[styles.corner, styles.cornerTopRight]} />
        <View style={[styles.corner, styles.cornerBottomLeft]} />
        <View style={[styles.corner, styles.cornerBottomRight]} />
      </View>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const STAGE_LABELS: Record<ScanStage, string> = {
  cropping: 'Cropping to the card…',
  reading: 'Reading the card…',
  matching: 'Matching…',
  art: 'Comparing card art…',
};

const CORNER = 28;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  centeredTitle: { textAlign: 'center' },
  centeredText: { textAlign: 'center', lineHeight: 21 },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    color: colors.accent,
    fontSize: 13,
  },
  syncBlock: { width: '100%', gap: spacing.sm, alignItems: 'center' },

  controls: { flex: 1, justifyContent: 'space-between' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  torch: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },

  guide: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 203, 5, 0.45)',
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.accent },
  cornerTopLeft: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.lg },
  cornerTopRight: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.lg },
  cornerBottomLeft: { bottom: -1, left: -1, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.lg },
  cornerBottomRight: { bottom: -1, right: -1, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.lg },

  footer: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  hint: {
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  errorBox: {
    maxHeight: 80,
    alignSelf: 'stretch',
    backgroundColor: colors.overlay,
    borderRadius: radius.md,
  },
  errorBoxInner: { padding: spacing.md },
  error: { color: colors.warning, textAlign: 'center', fontSize: 13 },

  shutter: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  shutterDisabled: { opacity: 0.5 },
});
