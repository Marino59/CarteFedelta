import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  createCardId,
  type BarcodeFormatType,
  type CardCategory,
  type LoyaltyCard,
} from '../types/card';
import { decodeCardsFromTransferHash } from './klarnaPasteParser';

export { createCardId };

const DB_NAME = 'carte-fedelta-db';
const DB_VERSION = 1;
const STORE_NAME = 'cards';

interface CarteDB extends DBSchema {
  cards: {
    key: string;
    value: LoyaltyCard;
    indexes: {
      'by-created': number;
      'by-store': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<CarteDB>> | null = null;

function getDb(): Promise<IDBPDatabase<CarteDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CarteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by-created', 'createdAt');
          store.createIndex('by-store', 'storeName');
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllCards(): Promise<LoyaltyCard[]> {
  const db = await getDb();
  const cards = await db.getAll(STORE_NAME);
  return cards.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    const usageDiff = (b.usageCount || 0) - (a.usageCount || 0);
    if (usageDiff !== 0) return usageDiff;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function isLocalSyncHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function pushCardsToSyncServer(): Promise<void> {
  if (!isLocalSyncHost() || typeof fetch !== 'function') return;
  try {
    const cards = await getAllCards();
    await fetch('/api/sync-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards }),
    });
  } catch {
    // Offline o senza dev server locale: nessuna azione bloccante
  }
}

export async function fetchSyncState(): Promise<{
  cards: LoyaltyCard[];
  lanUrl: string | null;
}> {
  if (!isLocalSyncHost() || typeof fetch !== 'function') {
    return { cards: [], lanUrl: null };
  }
  try {
    const res = await fetch('/api/sync-cards', { cache: 'no-store' });
    if (!res.ok) return { cards: [], lanUrl: null };
    const data = (await res.json()) as { cards?: unknown; lanUrl?: unknown };
    const normalized = Array.isArray(data.cards)
      ? parseAndNormalizeBackup(JSON.stringify({ cards: data.cards }))
      : [];
    const lanUrl = typeof data.lanUrl === 'string' ? data.lanUrl : null;
    return { cards: normalized, lanUrl };
  } catch {
    return { cards: [], lanUrl: null };
  }
}

function cardSignature(card: Pick<LoyaltyCard, 'storeName' | 'cardNumber'>): string {
  return `${card.storeName.trim().toLowerCase()}::${card.cardNumber.trim()}`;
}

export async function mergeIncomingCards(incoming: LoyaltyCard[]): Promise<{ added: number }> {
  if (incoming.length === 0) return { added: 0 };
  const db = await getDb();
  const existing = await db.getAll(STORE_NAME);
  const existingIds = new Set(existing.map((c) => c.id));
  const existingSigs = new Set(existing.map((c) => cardSignature(c)));

  let added = 0;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const card of incoming) {
    const sig = cardSignature(card);
    if (existingIds.has(card.id) || existingSigs.has(sig)) {
      continue;
    }
    existingIds.add(card.id);
    existingSigs.add(sig);
    tx.store.put(card);
    added += 1;
  }
  await tx.done;

  return { added };
}

export async function syncFromServerOrHash(): Promise<{
  addedFromHash: number;
  addedFromSync: number;
  lanUrl: string | null;
}> {
  if (typeof window === 'undefined') {
    return { addedFromHash: 0, addedFromSync: 0, lanUrl: null };
  }

  let addedFromHash = 0;
  let addedFromSync = 0;

  if (window.location.hash && window.location.hash.includes('import=')) {
    try {
      const fromHash = decodeCardsFromTransferHash(window.location.hash);
      const merged = await mergeIncomingCards(fromHash);
      addedFromHash = merged.added;
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    } catch {
      // Ignora hash malformato
    }
  }

  const syncState = await fetchSyncState();
  if (syncState.cards.length > 0) {
    const merged = await mergeIncomingCards(syncState.cards);
    addedFromSync = merged.added;
  } else {
    const localCards = await getAllCards();
    if (localCards.length > 0) {
      await pushCardsToSyncServer();
    }
  }

  if (addedFromHash > 0 && addedFromSync === 0) {
    void pushCardsToSyncServer();
  }

  if (window.location.search.includes('sync=1')) {
    const cleanParams = new URLSearchParams(window.location.search);
    cleanParams.delete('sync');
    const qs = cleanParams.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (qs ? `?${qs}` : '')
    );
  }

  return {
    addedFromHash,
    addedFromSync,
    lanUrl: syncState.lanUrl,
  };
}

export async function saveCard(card: LoyaltyCard): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, card);
  void pushCardsToSyncServer();
}

export async function saveMultipleCards(cards: LoyaltyCard[]): Promise<void> {
  if (cards.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const card of cards) {
    tx.store.put(card);
  }
  await tx.done;
  void pushCardsToSyncServer();
}

export async function deleteCard(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
  void pushCardsToSyncServer();
}

export async function incrementCardUsage(id: string): Promise<LoyaltyCard | undefined> {
  const db = await getDb();
  const card = await db.get(STORE_NAME, id);
  if (!card) return undefined;
  const updated: LoyaltyCard = {
    ...card,
    usageCount: (card.usageCount || 0) + 1,
    lastUsedAt: Date.now(),
  };
  await db.put(STORE_NAME, updated);
  return updated;
}

export async function toggleCardFavorite(id: string): Promise<LoyaltyCard | undefined> {
  const db = await getDb();
  const card = await db.get(STORE_NAME, id);
  if (!card) return undefined;
  const updated: LoyaltyCard = {
    ...card,
    isFavorite: !card.isFavorite,
  };
  await db.put(STORE_NAME, updated);
  void pushCardsToSyncServer();
  return updated;
}

export interface BackupPayload {
  app: string;
  version: number;
  exportedAt: string;
  cards: LoyaltyCard[];
}

export async function exportBackupJson(includeImages: boolean): Promise<string> {
  const cards = await getAllCards();
  const sanitized = cards.map((card) => {
    if (includeImages) return card;
    const { frontImage: _front, backImage: _back, ...rest } = card;
    return rest;
  });

  const payload: BackupPayload = {
    app: 'CarteFedeltaWallet',
    version: 1,
    exportedAt: new Date().toISOString(),
    cards: sanitized,
  };

  return JSON.stringify(payload, null, 2);
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

export function parseAndNormalizeBackup(jsonString: string): LoyaltyCard[] {
  const parsed: unknown = JSON.parse(jsonString);
  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { cards?: unknown[] }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : [];

  if (
    rawList.length === 0 &&
    !Array.isArray(parsed) &&
    !(typeof parsed === 'object' && parsed !== null && 'cards' in parsed)
  ) {
    throw new Error('Formato file di backup non riconosciuto.');
  }

  const normalized: LoyaltyCard[] = [];
  for (const item of rawList) {
    if (typeof item !== 'object' || item === null) continue;
    const raw = item as Record<string, unknown>;
    const storeName = typeof raw.storeName === 'string' ? raw.storeName.trim() : '';
    const cardNumber = typeof raw.cardNumber === 'string' ? raw.cardNumber.trim() : '';
    if (!storeName || !cardNumber) continue;

    const format =
      typeof raw.barcodeFormat === 'string' && VALID_FORMATS.has(raw.barcodeFormat as BarcodeFormatType)
        ? (raw.barcodeFormat as BarcodeFormatType)
        : 'CODE128';

    const category =
      typeof raw.category === 'string' && VALID_CATEGORIES.has(raw.category as CardCategory)
        ? (raw.category as CardCategory)
        : 'other';

    normalized.push({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createCardId(),
      storeName,
      cardNumber,
      barcodeFormat: format,
      color: typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#2563eb',
      category,
      holderName: typeof raw.holderName === 'string' ? raw.holderName : undefined,
      notes: typeof raw.notes === 'string' ? raw.notes : undefined,
      isFavorite: Boolean(raw.isFavorite),
      usageCount: typeof raw.usageCount === 'number' && Number.isFinite(raw.usageCount) ? raw.usageCount : 0,
      lastUsedAt: typeof raw.lastUsedAt === 'number' ? raw.lastUsedAt : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      frontImage: typeof raw.frontImage === 'string' ? raw.frontImage : undefined,
      backImage: typeof raw.backImage === 'string' ? raw.backImage : undefined,
      source:
        raw.source === 'camera' || raw.source === 'klarna' || raw.source === 'photo' || raw.source === 'manual'
          ? raw.source
          : 'manual',
    });
  }

  return normalized;
}

export async function importBackupJson(jsonString: string): Promise<{ imported: number; updated: number }> {
  const incoming = parseAndNormalizeBackup(jsonString);
  const db = await getDb();
  const existingKeys = new Set(await db.getAllKeys(STORE_NAME));

  let imported = 0;
  let updated = 0;

  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const card of incoming) {
    if (existingKeys.has(card.id)) {
      updated += 1;
    } else {
      imported += 1;
      existingKeys.add(card.id);
    }
    tx.store.put(card);
  }
  await tx.done;

  void pushCardsToSyncServer();

  return { imported, updated };
}
