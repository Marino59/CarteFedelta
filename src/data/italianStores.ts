import type { BarcodeFormatType, CardCategory } from '../types/card';

export interface StorePreset {
  id: string;
  name: string;
  keywords: string[];
  color: string;
  category: CardCategory;
  defaultFormat: BarcodeFormatType;
}

export const ITALIAN_STORES: StorePreset[] = [
  // Supermercati e Ipermercati
  {
    id: 'esselunga',
    name: 'Esselunga',
    keywords: ['esselunga', 'fidaty', 'esselunga fidaty', 'carta fidaty'],
    color: '#d91f26',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'conad',
    name: 'Conad',
    keywords: ['conad', 'carta insieme', 'insieme piu', 'spazio conad'],
    color: '#e30613',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'coop',
    name: 'Coop',
    keywords: ['coop', 'socio coop', 'novacoop', 'unicomm', 'alleanza 3.0', 'unicoop'],
    color: '#dc2626',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'carrefour',
    name: 'Carrefour',
    keywords: ['carrefour', 'payback carrefour', 'spesa amica'],
    color: '#1d4ed8',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'lidl',
    name: 'Lidl',
    keywords: ['lidl', 'lidl plus'],
    color: '#0050aa',
    category: 'supermarket',
    defaultFormat: 'QR',
  },
  {
    id: 'eurospin',
    name: 'Eurospin',
    keywords: ['eurospin', 'spesa intelligente'],
    color: '#1e3a8a',
    category: 'supermarket',
    defaultFormat: 'CODE128',
  },
  {
    id: 'pam-panorama',
    name: 'Pam Panorama',
    keywords: ['pam', 'panorama', 'pam panorama', 'per te pam', 'carta per te'],
    color: '#c8102e',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'despar',
    name: 'Despar',
    keywords: ['despar', 'eurospar', 'interspar', 'despar tribu'],
    color: '#15803d',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'famila',
    name: 'Famila',
    keywords: ['famila', 'famila superstore', 'emisfero', 'galassia'],
    color: '#ea580c',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'bennet',
    name: 'Bennet',
    keywords: ['bennet', 'bennet club'],
    color: '#b91c1c',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'tigros',
    name: 'Tigros',
    keywords: ['tigros', 'tigros card'],
    color: '#0369a1',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'iper',
    name: 'Iper',
    keywords: ['iper', 'la grande i', 'carta vantaggi iper'],
    color: '#e11d48',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'md',
    name: 'MD',
    keywords: ['md', 'md spa', 'md market', 'buona spesa'],
    color: '#f59e0b',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'penny',
    name: 'Penny',
    keywords: ['penny', 'penny market', 'pennycard'],
    color: '#dc2626',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'aldi',
    name: 'Aldi',
    keywords: ['aldi', 'aldi italia'],
    color: '#0284c7',
    category: 'supermarket',
    defaultFormat: 'CODE128',
  },
  {
    id: 'ali-aliper',
    name: 'Alì & Alìper',
    keywords: ['ali', 'aliper', 'carta fedelta ali', 'supermercati ali'],
    color: '#2563eb',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'prix',
    name: 'Prix',
    keywords: ['prix', 'prix quality'],
    color: '#1d4ed8',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'tosano',
    name: 'Tosano',
    keywords: ['tosano', 'ipermercato tosano'],
    color: '#0f766e',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'cadoro',
    name: 'Cadoro',
    keywords: ['cadoro', 'supermercati cadoro'],
    color: '#b45309',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'unes-u2',
    name: 'Unes / U2',
    keywords: ['unes', 'u2', 'il viaggiator goloso'],
    color: '#16a34a',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'crai',
    name: 'Crai',
    keywords: ['crai', 'carta piu crai'],
    color: '#d97706',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },
  {
    id: 'natura-si',
    name: 'NaturaSì',
    keywords: ['naturasi', 'natura si'],
    color: '#65a30d',
    category: 'supermarket',
    defaultFormat: 'EAN13',
  },

  // Casa & Fai da te
  {
    id: 'ikea',
    name: 'IKEA',
    keywords: ['ikea', 'ikea family'],
    color: '#0058a3',
    category: 'diy_home',
    defaultFormat: 'CODE128',
  },
  {
    id: 'leroy-merlin',
    name: 'Leroy Merlin',
    keywords: ['leroy', 'leroy merlin', 'ideapiu'],
    color: '#16a34a',
    category: 'diy_home',
    defaultFormat: 'EAN13',
  },
  {
    id: 'tecnomat',
    name: 'Tecnomat',
    keywords: ['tecnomat', 'bricoman'],
    color: '#ea580c',
    category: 'diy_home',
    defaultFormat: 'CODE128',
  },
  {
    id: 'obi',
    name: 'OBI',
    keywords: ['obi', 'heyobi'],
    color: '#f97316',
    category: 'diy_home',
    defaultFormat: 'EAN13',
  },
  {
    id: 'bricofer',
    name: 'Bricofer',
    keywords: ['bricofer', 'brico io', 'bricocenter'],
    color: '#dc2626',
    category: 'diy_home',
    defaultFormat: 'EAN13',
  },
  {
    id: 'kasanova',
    name: 'Kasanova',
    keywords: ['kasanova', 'vip card kasanova'],
    color: '#0284c7',
    category: 'diy_home',
    defaultFormat: 'EAN13',
  },

  // Elettronica & Libri
  {
    id: 'mediaworld',
    name: 'MediaWorld',
    keywords: ['mediaworld', 'media world', 'mediaworld club'],
    color: '#df0000',
    category: 'electronics',
    defaultFormat: 'EAN13',
  },
  {
    id: 'unieuro',
    name: 'Unieuro',
    keywords: ['unieuro', 'unieuro club'],
    color: '#003c88',
    category: 'electronics',
    defaultFormat: 'EAN13',
  },
  {
    id: 'euronics',
    name: 'Euronics',
    keywords: ['euronics', 'star club euronics'],
    color: '#1d4ed8',
    category: 'electronics',
    defaultFormat: 'EAN13',
  },
  {
    id: 'trony',
    name: 'Trony',
    keywords: ['trony', 'carta fan trony'],
    color: '#2563eb',
    category: 'electronics',
    defaultFormat: 'EAN13',
  },
  {
    id: 'feltrinelli',
    name: 'Feltrinelli',
    keywords: ['feltrinelli', 'la feltrinelli', 'carta effe'],
    color: '#dc2626',
    category: 'electronics',
    defaultFormat: 'EAN13',
  },
  {
    id: 'mondadori',
    name: 'Mondadori',
    keywords: ['mondadori', 'mondadori store', 'payback mondadori'],
    color: '#ea580c',
    category: 'electronics',
    defaultFormat: 'EAN13',
  },

  // Moda & Sport
  {
    id: 'decathlon',
    name: 'Decathlon',
    keywords: ['decathlon', 'carta decathlon', 'membership decathlon'],
    color: '#0082c3',
    category: 'fashion_sport',
    defaultFormat: 'EAN13',
  },
  {
    id: 'cisalfa',
    name: 'Cisalfa Sport',
    keywords: ['cisalfa', 'cisalfa pro'],
    color: '#0f172a',
    category: 'fashion_sport',
    defaultFormat: 'CODE128',
  },
  {
    id: 'ovs',
    name: 'OVS',
    keywords: ['ovs', 'ovsfriends'],
    color: '#334155',
    category: 'fashion_sport',
    defaultFormat: 'EAN13',
  },
  {
    id: 'coin',
    name: 'Coin',
    keywords: ['coin', 'coincard'],
    color: '#475569',
    category: 'fashion_sport',
    defaultFormat: 'EAN13',
  },
  {
    id: 'intimissimi',
    name: 'Intimissimi',
    keywords: ['intimissimi', 'my intimissimi'],
    color: '#1e293b',
    category: 'fashion_sport',
    defaultFormat: 'CODE128',
  },
  {
    id: 'calzedonia',
    name: 'Calzedonia',
    keywords: ['calzedonia', 'calzedonia lover'],
    color: '#9f1239',
    category: 'fashion_sport',
    defaultFormat: 'CODE128',
  },
  {
    id: 'hm',
    name: 'H&M',
    keywords: ['h&m', 'hm', 'h and m'],
    color: '#b91c1c',
    category: 'fashion_sport',
    defaultFormat: 'QR',
  },

  // Bellezza & Salute & Animali
  {
    id: 'tigota',
    name: 'Tigotà',
    keywords: ['tigota', 'fidelity tigota'],
    color: '#db2777',
    category: 'beauty_pharma',
    defaultFormat: 'EAN13',
  },
  {
    id: 'acqua-sapone',
    name: 'Acqua & Sapone',
    keywords: ['acqua & sapone', 'acqua e sapone', 'bolle'],
    color: '#0284c7',
    category: 'beauty_pharma',
    defaultFormat: 'EAN13',
  },
  {
    id: 'sephora',
    name: 'Sephora',
    keywords: ['sephora', 'beauty pass'],
    color: '#0f172a',
    category: 'beauty_pharma',
    defaultFormat: 'CODE128',
  },
  {
    id: 'douglas',
    name: 'Douglas',
    keywords: ['douglas', 'douglas beauty card'],
    color: '#0d9488',
    category: 'beauty_pharma',
    defaultFormat: 'EAN13',
  },
  {
    id: 'kiko',
    name: 'KIKO Milano',
    keywords: ['kiko', 'kiko milano', 'kiko kisses'],
    color: '#be185d',
    category: 'beauty_pharma',
    defaultFormat: 'CODE128',
  },
  {
    id: 'arcaplanet',
    name: 'Arcaplanet',
    keywords: ['arcaplanet', 'arcapet', 'arcard'],
    color: '#eab308',
    category: 'beauty_pharma',
    defaultFormat: 'EAN13',
  },
  {
    id: 'maxi-zoo',
    name: 'Maxi Zoo',
    keywords: ['maxi zoo', 'maxizoo', 'friends maxi zoo'],
    color: '#16a34a',
    category: 'beauty_pharma',
    defaultFormat: 'EAN13',
  },

  // Altro, Carburante & Trasporti
  {
    id: 'q8',
    name: 'Q8',
    keywords: ['q8', 'starq8', 'clubq8', 'kuwait'],
    color: '#1d4ed8',
    category: 'other',
    defaultFormat: 'EAN13',
  },
  {
    id: 'eni-live',
    name: 'Eni Live',
    keywords: ['eni', 'enilive', 'eni live', 'you&eni', 'enjoy'],
    color: '#ca8a04',
    category: 'other',
    defaultFormat: 'CODE128',
  },
  {
    id: 'payback',
    name: 'Payback',
    keywords: ['payback'],
    color: '#2563eb',
    category: 'other',
    defaultFormat: 'CODE128',
  },
  {
    id: 'autogrill',
    name: 'MyAutogrill',
    keywords: ['autogrill', 'myautogrill'],
    color: '#dc2626',
    category: 'other',
    defaultFormat: 'QR',
  },
  {
    id: 'tessera-sanitaria',
    name: 'Tessera Sanitaria / CF',
    keywords: ['tessera sanitaria', 'codice fiscale', 'sanitaria', 'cns'],
    color: '#0369a1',
    category: 'other',
    defaultFormat: 'CODE39',
  },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchStoreFromText(text: string): StorePreset | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  let bestMatch: { store: StorePreset; score: number } | null = null;

  for (const store of ITALIAN_STORES) {
    for (const rawKeyword of store.keywords) {
      const keyword = normalizeText(rawKeyword);
      if (!keyword) continue;

      let matched = false;
      if (keyword.length <= 3) {
        // Evita falsi positivi per sigle corte (es. "md", "q8", "u2", "hm", "ali")
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const boundaryRegex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`);
        matched = boundaryRegex.test(normalized);
      } else {
        matched = normalized.includes(keyword);
      }

      if (matched) {
        // Privilegia parole chiave più lunghe e specifiche (es. "esselunga fidaty" o "leroy merlin")
        const score = keyword.length + (normalized === keyword ? 20 : 0);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { store, score };
        }
      }
    }
  }

  return bestMatch ? bestMatch.store : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

export function findClosestStoreByColor(hex: string): StorePreset | null {
  const target = hexToRgb(hex);
  if (!target) return null;

  // Ignora sfondi quasi bianchi, quasi neri o grigi neutri di sistema
  const maxC = Math.max(target.r, target.g, target.b);
  const minC = Math.min(target.r, target.g, target.b);
  if (maxC - minC < 30) {
    return null;
  }

  let closest: { store: StorePreset; distance: number } | null = null;
  for (const store of ITALIAN_STORES) {
    const rgb = hexToRgb(store.color);
    if (!rgb) continue;
    const dr = target.r - rgb.r;
    const dg = target.g - rgb.g;
    const db = target.b - rgb.b;
    const dist = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
    if (!closest || dist < closest.distance) {
      closest = { store, distance: dist };
    }
  }

  if (closest && closest.distance <= 55) {
    return closest.store;
  }
  return null;
}
