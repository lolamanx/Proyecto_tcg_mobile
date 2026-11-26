import type { SQLiteDatabase } from 'expo-sqlite';
import { getArtMatching } from '@/db/meta';
import { cropToCard, recognizeCard, type OcrResult } from './ocr';
import { parseOcr, type ParsedCard } from './parse';
import { matchCard, type MatchResult } from './match';
import { rerankByArt, type ArtRerankOutcome } from './rerank';
import { FALLBACK_GUIDE, type Rect } from './geometry';

/**
 * The whole scan, start to finish, on device:
 *
 *   camera frame -> crop to the guide -> banded OCR -> parse -> match locally
 *
 * When OCR alone leaves the answer in doubt — usually because the collector
 * number was unreadable, leaving a shortlist of same-named reprints — the card's
 * artwork is compared as a second opinion. That step may download a few
 * thumbnails the first time it sees a given shortlist; everything else is local.
 *
 * Otherwise the only network call in the flow happens later, when the user picks
 * a card and the app pulls its full detail and USD price from TCGdex.
 */

export type ScanOutcome = {
  /** The cropped card image, kept so the confirm screen can show what was read. */
  imageUri: string;
  ocr: OcrResult;
  parsed: ParsedCard;
  match: MatchResult;
  /** What the art comparison did, if it ran. */
  art: ArtRerankOutcome;
  totalMs: number;
};

/** Steps the capture screen can surface while a scan is in flight. */
export type ScanStage = 'cropping' | 'reading' | 'matching' | 'art';

export type ScanOptions = {
  /** Card rectangle within the captured frame, as fractions (0..1). */
  guide?: Rect;
  fullFrame?: boolean;
  onStage?: (stage: ScanStage) => void;
  fastMode?: boolean;
  signal?: AbortSignal;
  /** Override the stored art-matching preference. */
  artMatching?: boolean;
  /** Compare art even when the OCR match is already confident. */
  forceArt?: boolean;
};

/**
 * Only used when the capture screen could not measure itself; normally it
 * derives the rectangle from the on-screen guide via `guideToPhotoRect`.
 */
export const DEFAULT_GUIDE = FALLBACK_GUIDE;

export async function scanCard(
  db: SQLiteDatabase,
  photoUri: string,
  options: ScanOptions = {}
): Promise<ScanOutcome> {
  const started = Date.now();
  const guide = options.guide ?? FALLBACK_GUIDE;

  options.onStage?.('cropping');
  const imageUri = options.fullFrame ? photoUri : await cropToCard(photoUri, guide);

  options.onStage?.('reading');
  const ocr = await recognizeCard(imageUri, {
    fastMode: options.fastMode,
    signal: options.signal,
  });

  options.onStage?.('matching');
  const parsed = parseOcr(ocr);
  const match = await matchCard(db, parsed);

  const artEnabled = options.artMatching ?? (await getArtMatching(db));
  const willCompareArt =
    artEnabled && match.candidates.length > 1 && (options.forceArt || match.confidence < 0.85);
  if (willCompareArt) options.onStage?.('art');
  const { result, art } = artEnabled
    ? await rerankByArt(db, imageUri, match, { force: options.forceArt, signal: options.signal })
    : {
        result: match,
        art: {
          ran: false,
          skipped: 'disabled' as const,
          evaluated: 0,
          fetched: 0,
          quality: 0,
          changedWinner: false,
          durationMs: 0,
        },
      };

  const outcome: ScanOutcome = {
    imageUri,
    ocr,
    parsed,
    match: result,
    art,
    totalMs: Date.now() - started,
  };
  await recordScan(db, outcome);
  return outcome;
}

/** Scan history doubles as a debugging trail for bad reads. */
export async function recordScan(db: SQLiteDatabase, outcome: ScanOutcome): Promise<void> {
  await db.runAsync(
    `INSERT INTO scans (created_at, ocr_text, parsed, matched_card_id, confidence, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    Date.now(),
    outcome.ocr.text,
    JSON.stringify({
      names: outcome.parsed.nameCandidates,
      numbers: outcome.parsed.numberCandidates,
      hp: outcome.parsed.hp,
      art: outcome.art.ran
        ? {
            evaluated: outcome.art.evaluated,
            fetched: outcome.art.fetched,
            bestDistance: outcome.art.bestDistance,
            quality: outcome.art.quality,
            changedWinner: outcome.art.changedWinner,
          }
        : { skipped: outcome.art.skipped },
    }),
    outcome.match.candidates[0]?.id ?? null,
    outcome.match.confidence,
    outcome.totalMs
  );
}

export type ScanRecord = {
  id: number;
  created_at: number;
  ocr_text: string | null;
  matched_card_id: string | null;
  confidence: number | null;
  duration_ms: number | null;
};

export function listScans(db: SQLiteDatabase, limit = 50) {
  return db.getAllAsync<ScanRecord>(
    `SELECT id, created_at, ocr_text, matched_card_id, confidence, duration_ms
     FROM scans ORDER BY created_at DESC LIMIT ?`,
    limit
  );
}

export function clearScans(db: SQLiteDatabase) {
  return db.runAsync('DELETE FROM scans');
}

/** Confidence bands the UI uses to decide how loudly to ask for confirmation. */
export function confidenceBand(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.78) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
}

export type { OcrResult, ParsedCard, MatchResult, ArtRerankOutcome };
