export type BarcodeFormatType =
  | 'CODE128'
  | 'EAN13'
  | 'EAN8'
  | 'CODE39'
  | 'ITF'
  | 'UPC'
  | 'CODABAR'
  | 'QR';

export type CardCategory =
  | 'supermarket'
  | 'diy_home'
  | 'electronics'
  | 'fashion_sport'
  | 'beauty_pharma'
  | 'other';

export type CardSource = 'camera' | 'klarna' | 'photo' | 'manual';

export interface LoyaltyCard {
  id: string;
  storeName: string;
  cardNumber: string;
  barcodeFormat: BarcodeFormatType;
  color: string;
  category: CardCategory;
  holderName?: string;
  notes?: string;
  isFavorite: boolean;
  sortOrder?: number;
  usageCount: number;
  lastUsedAt?: number;
  createdAt: number;
  frontImage?: string;
  backImage?: string;
  source?: CardSource;
}

export const BARCODE_FORMAT_OPTIONS: { value: BarcodeFormatType; label: string; description: string }[] = [
  { value: 'EAN13', label: 'EAN-13', description: 'Standard 13 cifre (supermercati)' },
  { value: 'CODE128', label: 'CODE 128', description: 'Universale numeri e lettere' },
  { value: 'EAN8', label: 'EAN-8', description: 'Compatto 8 cifre' },
  { value: 'CODE39', label: 'CODE 39', description: 'Codice alfanumerico / CF' },
  { value: 'ITF', label: 'ITF (Interleaved 2/5)', description: 'Coppie numeriche' },
  { value: 'UPC', label: 'UPC-A', description: '12 cifre standard USA' },
  { value: 'CODABAR', label: 'Codabar', description: 'Tessere biblioteche / negozi' },
  { value: 'QR', label: 'QR Code', description: 'Codice quadrato 2D' },
];

export const CATEGORY_OPTIONS: { value: CardCategory; label: string }[] = [
  { value: 'supermarket', label: 'Supermercati' },
  { value: 'diy_home', label: 'Casa & Fai da te' },
  { value: 'electronics', label: 'Elettronica & Libri' },
  { value: 'fashion_sport', label: 'Moda & Sport' },
  { value: 'beauty_pharma', label: 'Bellezza & Salute' },
  { value: 'other', label: 'Altro & Carburante' },
];

export const CARD_COLORS: string[] = [
  '#e11d48', // Rosso
  '#dc2626', // Rosso scuro
  '#ea580c', // Arancione
  '#d97706', // Ambra
  '#16a34a', // Verde
  '#059669', // Smeraldo
  '#0d9488', // Petrolio
  '#0284c7', // Blu cielo
  '#2563eb', // Blu
  '#4f46e5', // Indaco
  '#7c3aed', // Viola
  '#db2777', // Magenta
  '#334155', // Ardesia
  '#0f172a', // Nero notte
];

export function createCardId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
