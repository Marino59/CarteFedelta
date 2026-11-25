import { matchStoreFromText, type StorePreset } from '../data/italianStores';
import { createCardId, type BarcodeFormatType, type CardCategory, type LoyaltyCard } from '../types/card';

export interface ParsedPasteCard {
  storeName: string;
  cardNumber: string;
  barcodeFormat: BarcodeFormatType;
  color: string;
  category: CardCategory;
  matchedStore: StorePreset | null;
}

const VALID_FORMATS = new Set<BarcodeFormatType>([
  'CODE128',
  'EAN13',
  'EAN8',
  'CODE39',
  'ITF',
  'UPC',
  'CODABAR',
  'QR',
]);

const VALID_CATEGORIES = new Set<CardCategory>([
  'supermarket',
  'diy_home',
  'electronics',
  'fashion_sport',
  'beauty_pharma',
  'other',
]);

const NOISE_LINE_PATTERNS: RegExp[] = [
  /^(klarna|stocard|carte fedelt[aà]|le tue carte|wallet|portafoglio)$/i,
  /^(numero(\s+della)?\s*(carta|tessera)|codice(\s+a\s+barre)?|card\s*number|barcode)$/i,
  /^(mostra\s+alla\s+cassa|scansiona|modifica|elimina|condividi|note|dettagli|aggiungi\s+note|indietro|chiudi)$/i,
  /^(fronte|retro|foto|copia|incolla|salva)$/i,
];

function isBoilerplateLine(line: string): boolean {
  const cleaned = line.trim();
  if (!cleaned || cleaned.length < 2) return true;
  return NOISE_LINE_PATTERNS.some((re) => re.test(cleaned));
}

export function isValidGs1CheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  const payload = digits.slice(0, -1);
  const actualCheck = Number(digits[digits.length - 1]);

  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[payload.length - 1 - i]);
    const weight = i % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  const expectedCheck = (10 - (sum % 10)) % 10;
  return expectedCheck === actualCheck;
}

export function detectBestBarcodeFormat(
  code: string,
  preset?: StorePreset | null
): BarcodeFormatType {
  const trimmed = code.trim();

  if (/^\d{13}$/.test(trimmed) && isValidGs1CheckDigit(trimmed)) {
    return 'EAN13';
  }
  if (/^\d{8}$/.test(trimmed) && isValidGs1CheckDigit(trimmed)) {
    return 'EAN8';
  }
  if (/^\d{12}$/.test(trimmed) && isValidGs1CheckDigit(trimmed)) {
    return 'UPC';
  }
  if (/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i.test(trimmed)) {
    return 'CODE39';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return 'QR';
  }

  if (preset) {
    if (preset.defaultFormat === 'QR') return 'QR';
    if (preset.defaultFormat === 'CODE39' && /^[0-9A-Z\-. $/+%]+$/i.test(trimmed)) {
      return 'CODE39';
    }
    if (preset.defaultFormat === 'ITF' && /^\d+$/.test(trimmed) && trimmed.length % 2 === 0) {
      return 'ITF';
    }
  }

  return 'CODE128';
}

export function normalizePastedCode(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d+(?:[\s-]+\d+)+$/.test(trimmed)) {
    return trimmed.replace(/[\s-]+/g, '');
  }
  return trimmed;
}

function isStandaloneCodeCandidate(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Solo cifre, eventualmente separate da spazi o trattini (es. "0401 2345 6789 0")
  if (/^\d+(?:[\s-]+\d+)*$/.test(trimmed)) {
    const collapsed = trimmed.replace(/[\s-]+/g, '');
    if (collapsed.length >= 5 && collapsed.length <= 32) {
      return collapsed;
    }
    return null;
  }

  // URL o contenuto QR esplicito
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return trimmed;
  }

  // Codice alfanumerico senza spazi (es. Codice Fiscale o tessera alfanumerica)
  if (/^[A-Z0-9][A-Z0-9_-]{4,28}$/i.test(trimmed) && /\d/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function extractInlineStoreAndCode(line: string): { storePart: string; codePart: string } | null {
  const trimmed = line.trim();

  // 1. Separatori espliciti: tab, pipe, " - ", ": ", ";"
  const delimitedMatch = trimmed.match(
    /^(.+?)\s*(?:\t|\||;|\s[-–—:]\s|:\s+)\s*(.+)$/
  );
  if (delimitedMatch) {
    const left = delimitedMatch[1].trim();
    const right = delimitedMatch[2].trim();
    const rightCode = isStandaloneCodeCandidate(right);
    if (rightCode && left.length >= 2) {
      return { storePart: left, codePart: rightCode };
    }
    const leftCode = isStandaloneCodeCandidate(left);
    if (leftCode && right.length >= 2) {
      return { storePart: right, codePart: leftCode };
    }
  }

  // 2. Nome negozio seguito da uno spazio e un blocco numerico (anche spaziato es. "Esselunga 0401 2345 6789 0")
  const trailingDigitsMatch = trimmed.match(
    /^([A-Za-zÀ-ÿ0-9&'.,/ ]+?)\s+((?:\d[\s-]?){5,28}\d)$/
  );
  if (trailingDigitsMatch) {
    const storePart = trailingDigitsMatch[1].trim();
    const codePart = normalizePastedCode(trailingDigitsMatch[2]);
    if (storePart.length >= 2 && /[A-Za-zÀ-ÿ]/.test(storePart) && codePart.length >= 5) {
      return { storePart, codePart };
    }
  }

  // 3. Nome negozio seguito da codice alfanumerico contenente cifre (es. "Decathlon DEC123456")
  const trailingAlphaNumMatch = trimmed.match(
    /^([A-Za-zÀ-ÿ&'.,/ ]+?)\s+([A-Z0-9_-]*\d[A-Z0-9_-]{3,})$/i
  );
  if (trailingAlphaNumMatch) {
    const storePart = trailingAlphaNumMatch[1].trim();
    const codePart = trailingAlphaNumMatch[2].trim();
    if (storePart.length >= 2 && /[A-Za-zÀ-ÿ]/.test(storePart) && codePart.length >= 5) {
      return { storePart, codePart };
    }
  }

  return null;
}

function buildParsedCard(rawStore: string, code: string): ParsedPasteCard {
  const matchedStore = matchStoreFromText(rawStore);
  const storeName = matchedStore?.name || rawStore.trim() || 'Carta Fedeltà';
  const barcodeFormat = detectBestBarcodeFormat(code, matchedStore);

  return {
    storeName,
    cardNumber: code,
    barcodeFormat,
    color: matchedStore?.color || '#2563eb',
    category: matchedStore?.category || 'other',
    matchedStore,
  };
}

export function parseKlarnaPastedText(rawText: string): ParsedPasteCard[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const results: ParsedPasteCard[] = [];
  const seen = new Set<string>();
  let pendingStore: string | null = null;
  let pendingMatchedStore: StorePreset | null = null;

  const pushUnique = (card: ParsedPasteCard) => {
    const key = `${card.storeName.toLowerCase()}::${card.cardNumber}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(card);
  };

  for (const line of lines) {
    // Controlla prima se l'intera riga è un codice (es. "0 414 611 495 429")
    const standaloneCode = isStandaloneCodeCandidate(line);
    if (standaloneCode) {
      const storeLabel = pendingStore || 'Carta Fedeltà';
      pushUnique(buildParsedCard(storeLabel, standaloneCode));
      pendingStore = null;
      pendingMatchedStore = null;
      continue;
    }

    // Altrimenti prova a vedere se la riga contiene sia negozio che codice
    const inline = extractInlineStoreAndCode(line);
    if (inline) {
      pushUnique(buildParsedCard(inline.storePart, inline.codePart));
      pendingStore = null;
      pendingMatchedStore = null;
      continue;
    }

    // Ignora etichette di sistema dell'interfaccia Klarna
    if (isBoilerplateLine(line)) {
      continue;
    }

    // La riga è probabilmente un nome negozio (o sottotitolo carta come "Carta Fìdaty")
    const matched = matchStoreFromText(line);
    if (!pendingStore) {
      pendingStore = line;
      pendingMatchedStore = matched;
    } else if (matched && !pendingMatchedStore) {
      // Se la riga precedente era generica e questa corrisponde a una catena nota, preferisci questa
      pendingStore = line;
      pendingMatchedStore = matched;
    }
  }

  return results;
}

interface CompactTransferCard {
  n: string;
  c: string;
  f: BarcodeFormatType;
  co: string;
  ca: CardCategory;
  h?: string;
  no?: string;
  fa?: 1;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeCardsForTransferUrl(cards: LoyaltyCard[], baseUrl: string): {
  url: string;
  usedSyncFallback: boolean;
} {
  const compact: CompactTransferCard[] = cards.map((card) => {
    const entry: CompactTransferCard = {
      n: card.storeName,
      c: card.cardNumber,
      f: card.barcodeFormat,
      co: card.color,
      ca: card.category,
    };
    if (card.holderName) entry.h = card.holderName;
    if (card.notes) entry.no = card.notes;
    if (card.isFavorite) entry.fa = 1;
    return entry;
  });

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const json = JSON.stringify(compact);
  const encoded = bytesToBase64Url(new TextEncoder().encode(json));

  // Se il payload sta comodamente in un QR Code leggibile da fotocamera smartphone, usa #import=
  if (encoded.length <= 2300) {
    return {
      url: `${cleanBase}/#import=${encoded}`,
      usedSyncFallback: false,
    };
  }

  // Per tante carte, rimanda all'URL breve con ?sync=1 che scarica dal server locale
  return {
    url: `${cleanBase}/?sync=1`,
    usedSyncFallback: true,
  };
}

export function decodeCardsFromTransferHash(hashOrUrl: string): LoyaltyCard[] {
  const match = hashOrUrl.match(/#import=([A-Za-z0-9\-_]+)/);
  if (!match) return [];

  const bytes = base64UrlToBytes(match[1]);
  const json = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];

  const now = Date.now();
  const cards: LoyaltyCard[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Partial<CompactTransferCard> | null;
    if (!raw || typeof raw !== 'object') continue;
    const storeName = typeof raw.n === 'string' ? raw.n.trim() : '';
    const cardNumber = typeof raw.c === 'string' ? raw.c.trim() : '';
    if (!storeName || !cardNumber) continue;

    const format: BarcodeFormatType =
      typeof raw.f === 'string' && VALID_FORMATS.has(raw.f as BarcodeFormatType)
        ? (raw.f as BarcodeFormatType)
        : 'CODE128';

    const category: CardCategory =
      typeof raw.ca === 'string' && VALID_CATEGORIES.has(raw.ca as CardCategory)
        ? (raw.ca as CardCategory)
        : 'other';

    cards.push({
      id: createCardId(),
      storeName,
      cardNumber,
      barcodeFormat: format,
      color: typeof raw.co === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.co) ? raw.co : '#2563eb',
      category,
      holderName: typeof raw.h === 'string' ? raw.h : undefined,
      notes: typeof raw.no === 'string' ? raw.no : undefined,
      isFavorite: raw.fa === 1,
      usageCount: 0,
      createdAt: now + i,
      source: 'klarna',
    });
  }

  return cards;
}
