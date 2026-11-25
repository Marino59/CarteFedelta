import {
  BarcodeFormat,
  BinaryBitmap,
  BitArray,
  Code128Reader,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  NotFoundException,
  OneDReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';
import { findClosestStoreByColor, matchStoreFromText, type StorePreset } from '../data/italianStores';
import type { BarcodeFormatType, CardCategory } from '../types/card';
import {
  detectBestBarcodeFormat,
  isValidGs1CheckDigit,
  normalizePastedCode,
  parseKlarnaPastedText,
} from './klarnaPasteParser';

export interface DecodedBarcode {
  code: string;
  format: BarcodeFormatType;
}

export interface KlarnaImportCandidate {
  tempId: string;
  fileName: string;
  previewImage: string;
  cardNumber: string;
  barcodeFormat: BarcodeFormatType;
  storeName: string;
  color: string;
  category: CardCategory;
  matchedStore: StorePreset | null;
  ocrText?: string;
  status: 'decoded' | 'needs_code';
}

export interface GrayImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface BarcodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

interface NativeBarcodeDetectorResult {
  rawValue?: string;
  format?: string;
}

interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<NativeBarcodeDetectorResult[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
}

/**
 * Corregge il bug upstream in @zxing/library `Code128Reader.findStartPattern`,
 * dove `counters = counters.slice(2, counters.length)` accorcia l'array da 6 a 4 elementi
 * al primo bordo/testo incontrato a sinistra del codice a barre.
 */
function patchZXingCode128Reader(): void {
  const readerStatic = Code128Reader as unknown as {
    CODE_PATTERNS?: Int32Array[];
    MAX_AVG_VARIANCE?: number;
    MAX_INDIVIDUAL_VARIANCE?: number;
    CODE_START_A?: number;
    CODE_START_C?: number;
    findStartPattern?: (row: BitArray) => Int32Array;
    __patchedCopyWithin?: boolean;
  };

  if (readerStatic.__patchedCopyWithin || !readerStatic.CODE_PATTERNS) return;

  const oneDStatic = OneDReader as unknown as {
    patternMatchVariance: (
      counters: Int32Array,
      pattern: Int32Array,
      maxIndividualVariance: number
    ) => number;
  };

  const patterns = readerStatic.CODE_PATTERNS;
  const maxAvgVariance = readerStatic.MAX_AVG_VARIANCE ?? 0.25;
  const maxIndividualVariance = readerStatic.MAX_INDIVIDUAL_VARIANCE ?? 0.7;
  const startA = readerStatic.CODE_START_A ?? 103;
  const startC = readerStatic.CODE_START_C ?? 105;

  readerStatic.findStartPattern = function (row: BitArray): Int32Array {
    const width = row.getSize();
    const rowOffset = row.getNextSet(0);
    let counterPosition = 0;
    const counters = Int32Array.from([0, 0, 0, 0, 0, 0]);
    let patternStart = rowOffset;
    let isWhite = false;
    const patternLength = 6;

    for (let i = rowOffset; i < width; i++) {
      if (row.get(i) !== isWhite) {
        counters[counterPosition]++;
      } else {
        if (counterPosition === patternLength - 1) {
          let bestVariance = maxAvgVariance;
          let bestMatch = -1;
          for (let startCode = startA; startCode <= startC; startCode++) {
            const variance = oneDStatic.patternMatchVariance(
              counters,
              patterns[startCode],
              maxIndividualVariance
            );
            if (variance < bestVariance) {
              bestVariance = variance;
              bestMatch = startCode;
            }
          }
          if (
            bestMatch >= 0 &&
            row.isRange(
              Math.max(0, patternStart - Math.floor((i - patternStart) / 2)),
              patternStart,
              false
            )
          ) {
            return Int32Array.from([patternStart, i, bestMatch]);
          }
          patternStart += counters[0] + counters[1];
          counters.copyWithin(0, 2, 2 + counterPosition - 1);
          counters[counterPosition - 1] = 0;
          counters[counterPosition] = 0;
          counterPosition--;
        } else {
          counterPosition++;
        }
        counters[counterPosition] = 1;
        isWhite = !isWhite;
      }
    }
    throw new NotFoundException();
  };

  readerStatic.__patchedCopyWithin = true;
}

patchZXingCode128Reader();

const SUPPORTED_ZXING_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
  BarcodeFormat.AZTEC,
  BarcodeFormat.CODE_93,
];

export function mapZXingFormatToType(format: BarcodeFormat): BarcodeFormatType {
  switch (format) {
    case BarcodeFormat.EAN_13:
      return 'EAN13';
    case BarcodeFormat.EAN_8:
      return 'EAN8';
    case BarcodeFormat.CODE_128:
      return 'CODE128';
    case BarcodeFormat.CODE_39:
    case BarcodeFormat.CODE_93:
      return 'CODE39';
    case BarcodeFormat.ITF:
      return 'ITF';
    case BarcodeFormat.UPC_A:
    case BarcodeFormat.UPC_E:
      return 'UPC';
    case BarcodeFormat.CODABAR:
      return 'CODABAR';
    case BarcodeFormat.QR_CODE:
    case BarcodeFormat.AZTEC:
    case BarcodeFormat.DATA_MATRIX:
      return 'QR';
    default:
      return 'CODE128';
  }
}

function mapNativeFormatToType(format?: string): BarcodeFormatType {
  const normalized = (format || '').toLowerCase();
  if (normalized === 'ean_13') return 'EAN13';
  if (normalized === 'ean_8') return 'EAN8';
  if (normalized === 'code_128') return 'CODE128';
  if (normalized === 'code_39' || normalized === 'code_93') return 'CODE39';
  if (normalized === 'itf') return 'ITF';
  if (normalized === 'upc_a' || normalized === 'upc_e') return 'UPC';
  if (normalized === 'codabar') return 'CODABAR';
  if (normalized === 'qr_code' || normalized === 'aztec' || normalized === 'data_matrix') return 'QR';
  return 'CODE128';
}

function loadImageElement(source: File | string): Promise<{ img: HTMLImageElement; revoke?: () => void }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let objectUrl: string | undefined;

    const cleanupOnError = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };

    img.onload = () => {
      resolve({
        img,
        revoke: objectUrl ? () => URL.revokeObjectURL(objectUrl!) : undefined,
      });
    };
    img.onerror = () => {
      cleanupOnError();
      reject(new Error("Impossibile caricare l'immagine."));
    };

    if (typeof source === 'string') {
      img.src = source;
    } else {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    }
  });
}

function encodeCanvasBestFormat(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality);
  if (webp.startsWith('data:image/webp')) {
    return webp;
  }
  return canvas.toDataURL('image/jpeg', quality);
}

export async function compressImage(
  fileOrDataUrl: File | string,
  maxDimension = 1200,
  quality = 0.8
): Promise<string> {
  const { img, revoke } = await loadImageElement(fileOrDataUrl);
  try {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const maxSide = Math.max(srcW, srcH, 1);
    const scale = maxSide > maxDimension ? maxDimension / maxSide : 1;

    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D non disponibile.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return encodeCanvasBestFormat(canvas, quality);
  } finally {
    revoke?.();
  }
}

function buildMultiFormatReader(): MultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_ZXING_FORMATS);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

export function canvasToGrayImage(canvas: HTMLCanvasElement): GrayImage {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gray = new Uint8ClampedArray(width * height);
  if (!ctx) {
    gray.fill(255);
    return { data: gray, width, height };
  }

  const rgba = ctx.getImageData(0, 0, width, height).data;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const alpha = rgba[i + 3];
    if (alpha === 0) {
      gray[j] = 255;
      continue;
    }
    const lum = (306 * rgba[i] + 601 * rgba[i + 1] + 117 * rgba[i + 2] + 512) >> 10;
    if (alpha < 255) {
      // Compositing su fondo bianco per PNG con trasparenze
      gray[j] = Math.round((lum * alpha + 255 * (255 - alpha)) / 255);
    } else {
      gray[j] = lum;
    }
  }
  return { data: gray, width, height };
}

export function padGrayImageWithWhiteBorder(
  img: GrayImage,
  padPx = 48,
  integerScale = 1,
  binarizeThreshold?: number
): GrayImage {
  const scale = Math.max(1, Math.round(integerScale));
  const scaledW = img.width * scale;
  const scaledH = img.height * scale;
  const outW = scaledW + padPx * 2;
  const outH = scaledH + padPx * 2;

  const out = new Uint8ClampedArray(outW * outH);
  out.fill(255);

  const src = img.data;
  const srcW = img.width;
  const srcH = img.height;

  for (let y = 0; y < srcH; y++) {
    const srcRowOffset = y * srcW;
    const dstYBase = padPx + y * scale;
    for (let x = 0; x < srcW; x++) {
      let val = src[srcRowOffset + x];
      if (binarizeThreshold !== undefined) {
        val = val > binarizeThreshold ? 255 : 0;
      }
      const dstXBase = padPx + x * scale;
      if (scale === 1) {
        out[dstYBase * outW + dstXBase] = val;
      } else {
        for (let sy = 0; sy < scale; sy++) {
          const rowStart = (dstYBase + sy) * outW + dstXBase;
          for (let sx = 0; sx < scale; sx++) {
            out[rowStart + sx] = val;
          }
        }
      }
    }
  }

  return { data: out, width: outW, height: outH };
}

export function cropGrayImage(
  img: GrayImage,
  x: number,
  y: number,
  w: number,
  h: number
): GrayImage {
  const sx = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const sw = Math.max(1, Math.min(img.width - sx, Math.floor(w)));
  const sh = Math.max(1, Math.min(img.height - sy, Math.floor(h)));

  const out = new Uint8ClampedArray(sw * sh);
  for (let row = 0; row < sh; row++) {
    const srcStart = (sy + row) * img.width + sx;
    out.set(img.data.subarray(srcStart, srcStart + sw), row * sw);
  }
  return { data: out, width: sw, height: sh };
}

export function rotateGrayImage90(img: GrayImage): GrayImage {
  const outW = img.height;
  const outH = img.width;
  const out = new Uint8ClampedArray(outW * outH);
  for (let y = 0; y < img.height; y++) {
    const rowOff = y * img.width;
    const dstCol = img.height - 1 - y;
    for (let x = 0; x < img.width; x++) {
      out[x * outW + dstCol] = img.data[rowOff + x];
    }
  }
  return { data: out, width: outW, height: outH };
}

export function locateBarcodeBoxes(img: GrayImage): BarcodeBox[] {
  const { data, width, height } = img;
  if (width < 40 || height < 10) return [];

  const maxBarGap = Math.max(24, Math.floor(width * 0.04));
  const rowStep = height > 300 ? 2 : 1;

  interface RowRun {
    y: number;
    minX: number;
    maxX: number;
    transitions: number;
  }

  const rowRuns: RowRun[] = [];

  for (let y = 0; y < height; y += rowStep) {
    const rowOff = y * width;

    // Calcola min/max della riga per soglia adattiva locale alla riga
    let minLum = 255;
    let maxLum = 0;
    for (let x = 0; x < width; x += 2) {
      const v = data[rowOff + x];
      if (v < minLum) minLum = v;
      if (v > maxLum) maxLum = v;
    }
    if (maxLum - minLum < 45) continue;

    const mid = (minLum + maxLum) >> 1;

    let burstStart = -1;
    let burstLast = -1;
    let transitions = 0;
    let prevDark = data[rowOff] < mid;

    let bestStart = 0;
    let bestEnd = 0;
    let bestTransitions = 0;

    for (let x = 1; x < width; x++) {
      const isDark = data[rowOff + x] < mid;
      if (isDark !== prevDark) {
        prevDark = isDark;
        if (burstStart < 0 || x - burstLast > maxBarGap) {
          if (transitions > bestTransitions) {
            bestTransitions = transitions;
            bestStart = burstStart;
            bestEnd = burstLast;
          }
          burstStart = x;
          burstLast = x;
          transitions = 1;
        } else {
          burstLast = x;
          transitions += 1;
        }
      }
    }

    if (transitions > bestTransitions) {
      bestTransitions = transitions;
      bestStart = burstStart;
      bestEnd = burstLast;
    }

    if (bestTransitions >= 16 && bestEnd - bestStart >= 36) {
      rowRuns.push({
        y,
        minX: bestStart,
        maxX: bestEnd,
        transitions: bestTransitions,
      });
    }
  }

  if (rowRuns.length === 0) return [];

  // Raggruppa righe contigue con sovrapposizione orizzontale
  const boxes: BarcodeBox[] = [];
  for (const run of rowRuns) {
    let attached = false;
    for (const box of boxes) {
      const yGap = run.y - (box.y + box.h);
      const overlapX =
        Math.min(run.maxX, box.x + box.w) - Math.max(run.minX, box.x);
      if (yGap <= 16 && overlapX > 20) {
        const newMinX = Math.min(box.x, run.minX);
        const newMaxX = Math.max(box.x + box.w, run.maxX);
        const newMaxY = Math.max(box.y + box.h, run.y + rowStep);
        box.x = newMinX;
        box.w = newMaxX - newMinX;
        box.h = newMaxY - box.y;
        box.score += run.transitions;
        attached = true;
        break;
      }
    }
    if (!attached) {
      boxes.push({
        x: run.minX,
        y: run.y,
        w: run.maxX - run.minX,
        h: rowStep,
        score: run.transitions,
      });
    }
  }

  return boxes
    .filter((b) => b.w >= 40 && b.h >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((b) => {
      const padX = Math.max(18, Math.round(b.w * 0.08));
      const padY = Math.max(12, Math.round(b.h * 0.2));
      const nx = Math.max(0, b.x - padX);
      const ny = Math.max(0, b.y - padY);
      const nw = Math.min(width - nx, b.w + padX * 2);
      const nh = Math.min(height - ny, b.h + padY * 2);
      return { x: nx, y: ny, w: nw, h: nh, score: b.score };
    });
}

export function normalizeDecodedBarcode(code: string, format: BarcodeFormatType): DecodedBarcode {
  const trimmed = code.trim();
  // In Europa/Italia, i codici EAN-13 che iniziano con '0' (es. 0414611495429)
  // vengono spesso letti da ZXing/Chrome BarcodeDetector come UPC-A a 12 cifre senza lo '0' iniziale.
  if (format === 'UPC' && /^\d{12}$/.test(trimmed)) {
    return {
      code: `0${trimmed}`,
      format: 'EAN13',
    };
  }
  return { code: trimmed, format };
}

function tryDecodeGrayWithZXing(
  img: GrayImage,
  reader: MultiFormatReader
): DecodedBarcode | null {
  const attempts = [
    () =>
      new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(img.data, img.width, img.height))
      ),
    () =>
      new BinaryBitmap(
        new GlobalHistogramBinarizer(new RGBLuminanceSource(img.data, img.width, img.height))
      ),
    () =>
      new BinaryBitmap(
        new HybridBinarizer(new RGBLuminanceSource(img.data, img.width, img.height).invert())
      ),
  ];

  for (const makeBitmap of attempts) {
    try {
      const result = reader.decodeWithState(makeBitmap());
      const text = result.getText()?.trim();
      if (text) {
        return normalizeDecodedBarcode(text, mapZXingFormatToType(result.getBarcodeFormat()));
      }
    } catch {
      // Passa al tentativo successivo
    } finally {
      reader.reset();
    }
  }
  return null;
}

function tryMultiThresholdDecode(
  img: GrayImage,
  reader: MultiFormatReader,
  preferredScale?: number
): DecodedBarcode | null {
  const scale = preferredScale ?? (img.width < 420 ? 3 : img.width < 750 ? 2 : 1);

  const paddedRaw = padGrayImageWithWhiteBorder(img, 48, scale);
  const rawHit = tryDecodeGrayWithZXing(paddedRaw, reader);
  if (rawHit) return rawHit;

  if (scale !== 1) {
    const padded1x = padGrayImageWithWhiteBorder(img, 48, 1);
    const hit1x = tryDecodeGrayWithZXing(padded1x, reader);
    if (hit1x) return hit1x;
  }

  for (const threshold of [150, 125, 180]) {
    const paddedBin = padGrayImageWithWhiteBorder(img, 48, scale, threshold);
    const binHit = tryDecodeGrayWithZXing(paddedBin, reader);
    if (binHit) return binHit;
  }

  return null;
}

const CODE128_SUBPIXEL_PATTERNS: readonly (readonly number[])[] = [
  [2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3], [1, 2, 1, 3, 2, 2],
  [1, 3, 1, 2, 2, 2], [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2], [1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3],
  [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2], [1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1],
  [1, 1, 3, 2, 2, 2], [1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1], [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1], [3, 1, 1, 2, 2, 2],
  [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2], [3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1],
  [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1], [2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3],
  [1, 3, 1, 3, 2, 1], [1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1], [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1], [1, 3, 2, 1, 3, 1],
  [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1], [3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1],
  [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3], [2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1], [3, 1, 1, 1, 2, 3],
  [3, 1, 1, 3, 2, 1], [3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4], [1, 1, 1, 4, 2, 2],
  [1, 2, 1, 1, 2, 4], [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2], [1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4],
  [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4], [1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1],
  [2, 4, 1, 2, 1, 1], [2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1], [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2], [1, 2, 4, 1, 1, 2],
  [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2], [4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1],
  [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1], [1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1],
  [1, 1, 4, 1, 1, 3], [1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1], [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2], [2, 1, 1, 2, 1, 4],
  [2, 1, 1, 2, 3, 2],
];
const CODE128_STOP_PATTERN: readonly number[] = [2, 3, 3, 1, 1, 1, 2];

function matchCode128Pattern(
  runs: number[],
  offset: number,
  pattern: readonly number[],
  totalModules: number
): { sumErr: number; maxErr: number } {
  let sum = 0;
  for (let k = 0; k < pattern.length; k++) {
    sum += runs[offset + k];
  }
  if (sum <= 0) return { sumErr: Infinity, maxErr: Infinity };
  const scale = totalModules / sum;
  let sumErr = 0;
  let maxErr = 0;
  for (let k = 0; k < pattern.length; k++) {
    const err = Math.abs(runs[offset + k] * scale - pattern[k]);
    sumErr += err;
    if (err > maxErr) maxErr = err;
  }
  return { sumErr, maxErr };
}

function decodeCode128Symbols(startCode: number, dataCodes: number[]): string {
  let mode: 'A' | 'B' | 'C' = startCode === 103 ? 'A' : startCode === 104 ? 'B' : 'C';
  let shiftNext = false;
  let result = '';

  for (const code of dataCodes) {
    const activeMode = shiftNext
      ? mode === 'A'
        ? 'B'
        : mode === 'B'
          ? 'A'
          : mode
      : mode;
    shiftNext = false;

    if (activeMode === 'C') {
      if (code === 100) mode = 'B';
      else if (code === 101) mode = 'A';
      else if (code === 102) continue;
      else if (code < 100) result += code < 10 ? `0${code}` : String(code);
      else return '';
    } else if (activeMode === 'B') {
      if (code === 99) mode = 'C';
      else if (code === 101) mode = 'A';
      else if (code === 98) shiftNext = true;
      else if (code === 102) continue;
      else if (code < 95) result += String.fromCharCode(32 + code);
      else return '';
    } else {
      if (code === 99) mode = 'C';
      else if (code === 100) mode = 'B';
      else if (code === 98) shiftNext = true;
      else if (code === 102) continue;
      else if (code < 64) result += String.fromCharCode(32 + code);
      else if (code < 96) result += String.fromCharCode(code - 64);
      else return '';
    }
  }
  return result.trim();
}

export function decodeCode128Subpixel(img: GrayImage): DecodedBarcode | null {
  const { data, width, height } = img;
  if (width < 40 || height < 6) return null;

  const bands: readonly [number, number][] = [
    [0.35, 0.65],
    [0.25, 0.55],
    [0.45, 0.75],
    [0.2, 0.8],
    [0.05, 0.95],
  ];

  const profile = new Float64Array(width + 2);

  for (const [y1Ratio, y2Ratio] of bands) {
    const y1 = Math.floor(height * y1Ratio);
    const y2 = Math.max(y1 + 1, Math.floor(height * y2Ratio));
    const rows = y2 - y1;

    let minLum = 255;
    let maxLum = 0;
    profile[0] = 255;
    profile[width + 1] = 255;

    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = y1; y < y2; y++) {
        sum += data[y * width + x];
      }
      const avg = sum / rows;
      profile[x + 1] = avg;
      if (avg < minLum) minLum = avg;
      if (avg > maxLum) maxLum = avg;
    }

    if (maxLum - minLum < 45) continue;

    const mid = (minLum + maxLum) * 0.5;
    const candidateThresholds = [mid, 128, mid - 18, mid + 18].filter(
      (t) => t > minLum + 8 && t < maxLum - 8
    );

    for (const thresh of candidateThresholds) {
      const edges: number[] = [];
      for (let i = 0; i <= width; i++) {
        const a = profile[i];
        const b = profile[i + 1];
        if ((a < thresh) !== (b < thresh)) {
          edges.push(i + (thresh - a) / (b - a));
        }
      }

      if (edges.length < 26) continue;
      const subRuns: number[] = [];
      for (let i = 0; i < edges.length - 1; i++) {
        subRuns.push(edges[i + 1] - edges[i]);
      }

      // subRuns[0] è sempre nero perché profile[0] = 255 > thresh
      for (let startIdx = 0; startIdx + 25 <= subRuns.length; startIdx += 2) {
        let startCode = -1;
        let bestStartErr = Infinity;
        for (const candidateStart of [103, 104, 105]) {
          const { sumErr, maxErr } = matchCode128Pattern(
            subRuns,
            startIdx,
            CODE128_SUBPIXEL_PATTERNS[candidateStart],
            11
          );
          if (maxErr <= 0.75 && sumErr <= 1.65 && sumErr < bestStartErr) {
            bestStartErr = sumErr;
            startCode = candidateStart;
          }
        }
        if (startCode < 0) continue;

        let startWidth = 0;
        for (let k = 0; k < 6; k++) startWidth += subRuns[startIdx + k];
        if (startIdx >= 2 && subRuns[startIdx - 1] < startWidth * 0.45) {
          continue;
        }

        const codes: number[] = [];
        let pos = startIdx + 6;
        let foundStop = false;

        while (pos + 7 <= subRuns.length) {
          const stopCheck = matchCode128Pattern(subRuns, pos, CODE128_STOP_PATTERN, 13);
          if (codes.length >= 2 && stopCheck.maxErr <= 0.85 && stopCheck.sumErr <= 2.1) {
            foundStop = true;
            break;
          }
          if (pos + 13 > subRuns.length) break;

          let bestCode = -1;
          let bestErr = Infinity;
          let bestMaxErr = Infinity;
          for (let c = 0; c <= 102; c++) {
            const { sumErr, maxErr } = matchCode128Pattern(
              subRuns,
              pos,
              CODE128_SUBPIXEL_PATTERNS[c],
              11
            );
            if (sumErr < bestErr) {
              bestErr = sumErr;
              bestMaxErr = maxErr;
              bestCode = c;
            }
          }

          if (bestCode < 0 || bestMaxErr > 0.9 || bestErr > 2.2) {
            break;
          }
          codes.push(bestCode);
          pos += 6;
        }

        if (!foundStop || codes.length < 2) continue;

        const dataCodes = codes.slice(0, -1);
        const checkCode = codes[codes.length - 1];
        let weightedSum = startCode;
        for (let i = 0; i < dataCodes.length; i++) {
          weightedSum += (i + 1) * dataCodes[i];
        }
        if (weightedSum % 103 !== checkCode) continue;

        const decodedText = decodeCode128Symbols(startCode, dataCodes);
        if (decodedText) {
          return {
            code: decodedText,
            format: 'CODE128',
          };
        }
      }
    }
  }

  return null;
}

const EAN_L_PATTERNS: readonly (readonly number[])[] = [
  [3, 2, 1, 1],
  [2, 2, 2, 1],
  [2, 1, 2, 2],
  [1, 4, 1, 1],
  [1, 1, 3, 2],
  [1, 2, 3, 1],
  [1, 1, 1, 4],
  [1, 3, 1, 2],
  [1, 2, 1, 3],
  [3, 1, 1, 2],
];
const EAN_G_PATTERNS: readonly (readonly number[])[] = EAN_L_PATTERNS.map((p) =>
  [...p].reverse()
);
const EAN13_PARITY_FIRST_DIGIT: Record<string, string> = {
  LLLLLL: '0',
  LLGLGG: '1',
  LLGGLG: '2',
  LLGGGL: '3',
  LGLLGG: '4',
  LGGLLG: '5',
  LGGGLL: '6',
  LGLGLG: '7',
  LGLGGL: '8',
  LGGLGL: '9',
};

function matchEanDigit(
  runs: number[],
  offset: number,
  allowG: boolean
): { digit: string; parity: 'L' | 'G'; err: number; maxErr: number } {
  const sum = runs[offset] + runs[offset + 1] + runs[offset + 2] + runs[offset + 3];
  if (sum <= 0) return { digit: '0', parity: 'L', err: Infinity, maxErr: Infinity };
  const scale = 7 / sum;

  let bestDigit = '0';
  let bestParity: 'L' | 'G' = 'L';
  let bestErr = Infinity;
  let bestMaxErr = Infinity;

  for (let d = 0; d < 10; d++) {
    const patL = EAN_L_PATTERNS[d];
    let errL = 0;
    let maxL = 0;
    for (let k = 0; k < 4; k++) {
      const diff = Math.abs(runs[offset + k] * scale - patL[k]);
      errL += diff;
      if (diff > maxL) maxL = diff;
    }
    if (errL < bestErr) {
      bestErr = errL;
      bestMaxErr = maxL;
      bestDigit = String(d);
      bestParity = 'L';
    }

    if (allowG) {
      const patG = EAN_G_PATTERNS[d];
      let errG = 0;
      let maxG = 0;
      for (let k = 0; k < 4; k++) {
        const diff = Math.abs(runs[offset + k] * scale - patG[k]);
        errG += diff;
        if (diff > maxG) maxG = diff;
      }
      if (errG < bestErr) {
        bestErr = errG;
        bestMaxErr = maxG;
        bestDigit = String(d);
        bestParity = 'G';
      }
    }
  }

  return { digit: bestDigit, parity: bestParity, err: bestErr, maxErr: bestMaxErr };
}

function isUniformGuard(runs: number[], offset: number, count: number): boolean {
  let sum = 0;
  for (let k = 0; k < count; k++) sum += runs[offset + k];
  if (sum <= 0) return false;
  const avg = sum / count;
  for (let k = 0; k < count; k++) {
    if (Math.abs(runs[offset + k] / avg - 1) > 0.65) {
      return false;
    }
  }
  return true;
}

export function decodeEanSubpixel(img: GrayImage): DecodedBarcode | null {
  const { data, width, height } = img;
  if (width < 40 || height < 6) return null;

  const bands: readonly [number, number][] = [
    [0.35, 0.65],
    [0.25, 0.55],
    [0.45, 0.75],
    [0.2, 0.8],
    [0.05, 0.95],
  ];

  const profile = new Float64Array(width + 2);

  for (const [y1Ratio, y2Ratio] of bands) {
    const y1 = Math.floor(height * y1Ratio);
    const y2 = Math.max(y1 + 1, Math.floor(height * y2Ratio));
    const rows = y2 - y1;

    let minLum = 255;
    let maxLum = 0;
    profile[0] = 255;
    profile[width + 1] = 255;

    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = y1; y < y2; y++) {
        sum += data[y * width + x];
      }
      const avg = sum / rows;
      profile[x + 1] = avg;
      if (avg < minLum) minLum = avg;
      if (avg > maxLum) maxLum = avg;
    }

    if (maxLum - minLum < 45) continue;

    const mid = (minLum + maxLum) * 0.5;
    const candidateThresholds = [mid, 128, mid - 18, mid + 18].filter(
      (t) => t > minLum + 8 && t < maxLum - 8
    );

    for (const thresh of candidateThresholds) {
      const edges: number[] = [];
      for (let i = 0; i <= width; i++) {
        const a = profile[i];
        const b = profile[i + 1];
        if ((a < thresh) !== (b < thresh)) {
          edges.push(i + (thresh - a) / (b - a));
        }
      }

      if (edges.length < 44) continue;
      const subRuns: number[] = [];
      for (let i = 0; i < edges.length - 1; i++) {
        subRuns.push(edges[i + 1] - edges[i]);
      }

      // Prova sia EAN-13 (59 run) che EAN-8 (43 run) partendo da ogni barra nera
      for (let startIdx = 0; startIdx + 43 <= subRuns.length; startIdx += 2) {
        if (!isUniformGuard(subRuns, startIdx, 3)) continue;

        const guardWidth = subRuns[startIdx] + subRuns[startIdx + 1] + subRuns[startIdx + 2];
        if (startIdx >= 2 && subRuns[startIdx - 1] < guardWidth * 0.8) {
          continue;
        }

        // Tentativo EAN-13 (59 run)
        if (startIdx + 59 <= subRuns.length) {
          const midOffset = startIdx + 3 + 24;
          const endOffset = midOffset + 5 + 24;
          if (
            isUniformGuard(subRuns, midOffset, 5) &&
            isUniformGuard(subRuns, endOffset, 3)
          ) {
            let validDigits = true;
            let parities = '';
            let digits = '';

            for (let d = 0; d < 6; d++) {
              const hit = matchEanDigit(subRuns, startIdx + 3 + d * 4, true);
              if (hit.maxErr > 0.85 || hit.err > 2.0) {
                validDigits = false;
                break;
              }
              parities += hit.parity;
              digits += hit.digit;
            }

            if (validDigits) {
              const firstDigit = EAN13_PARITY_FIRST_DIGIT[parities];
              if (firstDigit) {
                for (let d = 0; d < 6; d++) {
                  const hit = matchEanDigit(subRuns, midOffset + 5 + d * 4, false);
                  if (hit.maxErr > 0.85 || hit.err > 2.0) {
                    validDigits = false;
                    break;
                  }
                  digits += hit.digit;
                }
                if (validDigits) {
                  const candidate = firstDigit + digits;
                  if (isValidGs1CheckDigit(candidate)) {
                    return { code: candidate, format: 'EAN13' };
                  }
                }
              }
            }
          }
        }

        // Tentativo EAN-8 (43 run)
        if (startIdx + 43 <= subRuns.length) {
          const midOffset = startIdx + 3 + 16;
          const endOffset = midOffset + 5 + 16;
          if (
            isUniformGuard(subRuns, midOffset, 5) &&
            isUniformGuard(subRuns, endOffset, 3)
          ) {
            let validDigits = true;
            let digits = '';
            for (let d = 0; d < 4; d++) {
              const hit = matchEanDigit(subRuns, startIdx + 3 + d * 4, false);
              if (hit.maxErr > 0.85 || hit.err > 2.0) {
                validDigits = false;
                break;
              }
              digits += hit.digit;
            }
            if (validDigits) {
              for (let d = 0; d < 4; d++) {
                const hit = matchEanDigit(subRuns, midOffset + 5 + d * 4, false);
                if (hit.maxErr > 0.85 || hit.err > 2.0) {
                  validDigits = false;
                  break;
                }
                digits += hit.digit;
              }
              if (validDigits && isValidGs1CheckDigit(digits)) {
                return { code: digits, format: 'EAN8' };
              }
            }
          }
        }
      }
    }
  }

  return null;
}

export function decodeBarcodeFromLuminance(
  luminances: Uint8ClampedArray,
  width: number,
  height: number
): DecodedBarcode | null {
  const reader = buildMultiFormatReader();
  const baseImg: GrayImage = { data: luminances, width, height };

  // 1. Immagine intera con quiet zone bianca e scaling intero
  const fullHit = tryMultiThresholdDecode(baseImg, reader);
  if (fullHit) return fullHit;

  // 1b. Decodificatori sub-pixel (ideali per catture schermo piccole/compresse 1.1px/modulo)
  const subpixelCode128 = decodeCode128Subpixel(baseImg);
  if (subpixelCode128) return subpixelCode128;

  const subpixelEan = decodeEanSubpixel(baseImg);
  if (subpixelEan) return subpixelEan;

  // 2. Localizzatore automatico regione codice a barre (per catture schermo PC intere o con bordi scuri)
  const candidateBoxes = locateBarcodeBoxes(baseImg);
  for (const box of candidateBoxes) {
    const region = cropGrayImage(baseImg, box.x, box.y, box.w, box.h);
    const boxScale = region.width < 360 ? 3 : region.width < 720 ? 2 : 1;
    const regionHit = tryMultiThresholdDecode(region, reader, boxScale);
    if (regionHit) return regionHit;

    const subpixelRegion128 = decodeCode128Subpixel(region);
    if (subpixelRegion128) return subpixelRegion128;

    const subpixelRegionEan = decodeEanSubpixel(region);
    if (subpixelRegionEan) return subpixelRegionEan;
  }

  // 3. Ritagli orizzontali a larghezza piena (0..1) per screenshot verticali
  const verticalBands: [number, number][] = [
    [0.15, 0.85],
    [0.25, 0.75],
    [0.35, 0.65],
    [0.1, 0.55],
    [0.45, 0.9],
  ];

  for (const [y1, y2] of verticalBands) {
    const sy = Math.floor(height * y1);
    const sh = Math.max(1, Math.floor(height * (y2 - y1)));
    const band = cropGrayImage(baseImg, 0, sy, width, sh);
    const bandScale = band.width < 480 ? 2 : 1;
    const bandHit = tryMultiThresholdDecode(band, reader, bandScale);
    if (bandHit) return bandHit;
  }

  // 4. Rotazione di 90 gradi (tessere fotografate in verticale)
  const rotated = rotateGrayImage90(baseImg);
  const rotatedHit = tryMultiThresholdDecode(rotated, reader);
  if (rotatedHit) return rotatedHit;

  const subpixelRot = decodeCode128Subpixel(rotated);
  if (subpixelRot) return subpixelRot;

  const subpixelRotEan = decodeEanSubpixel(rotated);
  if (subpixelRotEan) return subpixelRotEan;

  const rotBoxes = locateBarcodeBoxes(rotated);
  for (const box of rotBoxes) {
    const region = cropGrayImage(rotated, box.x, box.y, box.w, box.h);
    const boxScale = region.width < 360 ? 3 : region.width < 720 ? 2 : 1;
    const regionHit = tryMultiThresholdDecode(region, reader, boxScale);
    if (regionHit) return regionHit;

    const subpixelRotRegion = decodeCode128Subpixel(region);
    if (subpixelRotRegion) return subpixelRotRegion;

    const subpixelRotRegionEan = decodeEanSubpixel(region);
    if (subpixelRotRegionEan) return subpixelRotRegionEan;
  }

  return null;
}

function padCanvasWithWhiteForNativeDetector(
  source: HTMLCanvasElement,
  padPx = 48
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width + padPx * 2;
  out.height = source.height + padPx * 2;
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, padPx, padPx);
  }
  return out;
}

async function tryNativeBarcodeDetector(canvas: HTMLCanvasElement): Promise<DecodedBarcode | null> {
  const win = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorConstructor };
  if (typeof window === 'undefined' || !win.BarcodeDetector) return null;

  try {
    const detector = new win.BarcodeDetector({
      formats: [
        'ean_13',
        'ean_8',
        'code_128',
        'code_39',
        'itf',
        'upc_a',
        'upc_e',
        'codabar',
        'qr_code',
        'aztec',
        'data_matrix',
      ],
    });
    const results = await detector.detect(canvas);
    for (const item of results) {
      const value = item.rawValue?.trim();
      if (value) {
        return normalizeDecodedBarcode(value, mapNativeFormatToType(item.format));
      }
    }
  } catch {
    // Fallback su ZXing se BarcodeDetector non supporta tutti i formati
  }
  return null;
}

function drawImageToWorkingCanvas(img: HTMLImageElement, maxWidth = 2400): HTMLCanvasElement {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const maxSide = Math.max(srcW, srcH, 1);
  const scale = maxSide > maxWidth ? maxWidth / maxSide : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

export async function decodeBarcodeFromCanvas(canvas: HTMLCanvasElement): Promise<DecodedBarcode | null> {
  // Passo 1: BarcodeDetector nativo (originale e con quiet zone bianca)
  const nativeHit = await tryNativeBarcodeDetector(canvas);
  if (nativeHit) return nativeHit;

  const paddedCanvas = padCanvasWithWhiteForNativeDetector(canvas, 48);
  const nativePaddedHit = await tryNativeBarcodeDetector(paddedCanvas);
  if (nativePaddedHit) return nativePaddedHit;

  // Passo 2: Pipeline avanzata ZXing su buffer luminanza immutabile
  const gray = canvasToGrayImage(canvas);
  return decodeBarcodeFromLuminance(gray.data, gray.width, gray.height);
}

export function extractCardNumberFromText(
  text: string,
  matchedStore?: StorePreset | null
): DecodedBarcode | null {
  if (!text || !text.trim()) return null;

  // 1. Prova prima con il parser strutturato
  const parsed = parseKlarnaPastedText(text);
  if (parsed.length > 0) {
    const first = parsed[0];
    return {
      code: first.cardNumber,
      format: first.barcodeFormat,
    };
  }

  // 2. Cerca sequenze numeriche tipiche di carte fedeltà (anche con spazi interni)
  const matches = text.match(/(?:\d[\s-]?){7,24}\d/g) || [];
  let bestDigits = '';
  for (const raw of matches) {
    const digits = normalizePastedCode(raw);
    if (!/^\d+$/.test(digits)) continue;
    // Privilegia codici da 12-16 cifre tipici di EAN-13 / carte fedeltà rispetto a numeri corti o anni
    if (digits.length >= 8 && digits.length <= 24) {
      if (
        !bestDigits ||
        (digits.length >= 12 && bestDigits.length < 12) ||
        digits.length > bestDigits.length
      ) {
        bestDigits = digits;
      }
    }
  }

  if (bestDigits) {
    return {
      code: bestDigits,
      format: detectBestBarcodeFormat(bestDigits, matchedStore),
    };
  }

  return null;
}

export async function decodeBarcodeFromImage(file: File | string): Promise<DecodedBarcode | null> {
  const { img, revoke } = await loadImageElement(file);
  try {
    const canvas = drawImageToWorkingCanvas(img, 2400);
    const optical = await decodeBarcodeFromCanvas(canvas);
    if (optical) return optical;

    // Fallback OCR se le barre sono troppo sfocate o piccole ma il numero sotto al codice è leggibile
    const ocrText = await recognizeImageTextWithTimeout(canvas, 5000);
    if (ocrText) {
      const storeHint = matchStoreFromText(ocrText);
      const fromText = extractCardNumberFromText(ocrText, storeHint);
      if (fromText) return fromText;
    }

    return null;
  } finally {
    revoke?.();
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function extractDominantCardColor(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '#2563eb';

  const sx = Math.floor(canvas.width * 0.12);
  const sy = Math.floor(canvas.height * 0.12);
  const sw = Math.max(1, Math.floor(canvas.width * 0.76));
  const sh = Math.max(1, Math.floor(canvas.height * 0.34));

  const { data } = ctx.getImageData(sx, sy, sw, sh);
  const buckets = new Map<string, { count: number; rSum: number; gSum: number; bSum: number }>();

  for (let i = 0; i < data.length; i += 24) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 180) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturationDelta = max - min;
    const luminance = (r + g + b) / 3;

    if (luminance > 235 || luminance < 22 || saturationDelta < 28) continue;

    const key = `${Math.floor(r / 24)}-${Math.floor(g / 24)}-${Math.floor(b / 24)}`;
    const entry = buckets.get(key) || { count: 0, rSum: 0, gSum: 0, bSum: 0 };
    entry.count += 1;
    entry.rSum += r;
    entry.gSum += g;
    entry.bSum += b;
    buckets.set(key, entry);
  }

  let best: { count: number; rSum: number; gSum: number; bSum: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) {
      best = bucket;
    }
  }

  if (!best || best.count < 5) return '#2563eb';
  return rgbToHex(best.rSum / best.count, best.gSum / best.count, best.bSum / best.count);
}

let ocrWorkerPromise: Promise<TesseractWorker> | null = null;

async function getOcrWorker(): Promise<TesseractWorker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng').catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

export async function terminateOcrWorker(): Promise<void> {
  if (!ocrWorkerPromise) return;
  try {
    const worker = await ocrWorkerPromise;
    await worker.terminate();
  } catch {
    // Ignora errori di chiusura worker
  } finally {
    ocrWorkerPromise = null;
  }
}

function buildOcrPreparedCanvas(source: HTMLCanvasElement, yStartRatio = 0, yEndRatio = 1): HTMLCanvasElement {
  const sx = 0;
  const sy = Math.floor(source.height * yStartRatio);
  const sw = source.width;
  const sh = Math.max(1, Math.floor(source.height * (yEndRatio - yStartRatio)));

  // Se l'immagine è piccola (es. ritaglio schermo), raddoppiala per migliorare l'OCR dei numeri
  const scale = sw < 600 ? 2 : 1;
  const out = document.createElement('canvas');
  out.width = sw * scale;
  out.height = sh * scale;
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  }
  return out;
}

async function recognizeImageTextWithTimeout(
  canvas: HTMLCanvasElement,
  timeoutMs = 5000,
  yStartRatio = 0,
  yEndRatio = 1
): Promise<string> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false && !ocrWorkerPromise) {
    return '';
  }

  const prepared = buildOcrPreparedCanvas(canvas, yStartRatio, yEndRatio);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ocrPromise = (async () => {
      const worker = await getOcrWorker();
      const { data } = await worker.recognize(prepared);
      return data.text || '';
    })();

    const timeoutPromise = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(''), timeoutMs);
    });

    return await Promise.race([ocrPromise, timeoutPromise]);
  } catch {
    return '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function guessStoreNameFromOcrOrFile(ocrText: string, fileName: string): string {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.replace(/[^a-zA-Z0-9àèéìòùÀÈÉÌÒÙ&' .-]/g, ' ').trim())
    .filter((line) => line.length >= 3 && !/^\d[\d\s-]*$/.test(line));

  if (lines.length > 0) {
    return lines[0].slice(0, 32);
  }

  const cleanedFile = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/screenshot|klarna|stocard|img|pxl|whatsapp|image|\d{6,}/gi, ' ')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (cleanedFile.length >= 3) {
    return cleanedFile.slice(0, 32);
  }
  return '';
}

export async function analyzeKlarnaScreenshot(
  file: File,
  tempId: string
): Promise<KlarnaImportCandidate> {
  const { img, revoke } = await loadImageElement(file);
  try {
    const workingCanvas = drawImageToWorkingCanvas(img, 2400);
    const [decodedOptical, previewImage] = await Promise.all([
      decodeBarcodeFromCanvas(workingCanvas),
      compressImage(file, 1080, 0.78),
    ]);

    const dominantColor = extractDominantCardColor(workingCanvas);

    // 1. Prova prima dal nome del file (istantaneo)
    let matchedStore = matchStoreFromText(file.name);
    let ocrText = '';
    let decoded = decodedOptical;

    // 2. Se serve il negozio o se la lettura ottica delle barre non ha trovato il codice, usa OCR
    if (!matchedStore || !decoded) {
      const yStart = !decoded ? 0 : 0.03;
      const yEnd = !decoded ? 1 : 0.45;
      ocrText = await recognizeImageTextWithTimeout(workingCanvas, 5000, yStart, yEnd);
      if (ocrText) {
        if (!matchedStore) {
          matchedStore = matchStoreFromText(ocrText);
        }
        if (!decoded) {
          decoded = extractCardNumberFromText(ocrText, matchedStore);
        }
      }
    }

    // 3. Fallback sul colore brand tipico dello screenshot
    const colorMatch = !matchedStore ? findClosestStoreByColor(dominantColor) : null;
    const finalStore = matchedStore || colorMatch;

    const guessedName = finalStore
      ? finalStore.name
      : guessStoreNameFromOcrOrFile(ocrText, file.name);

    return {
      tempId,
      fileName: file.name,
      previewImage,
      cardNumber: decoded?.code || '',
      barcodeFormat: decoded?.format || finalStore?.defaultFormat || 'CODE128',
      storeName: guessedName,
      color: finalStore?.color || dominantColor,
      category: finalStore?.category || 'other',
      matchedStore: finalStore,
      ocrText,
      status: decoded?.code ? 'decoded' : 'needs_code',
    };
  } finally {
    revoke?.();
  }
}
