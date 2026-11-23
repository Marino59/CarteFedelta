import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Edit3,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { LoyaltyCard } from '../types/card';
import { BarcodeDisplay, formatCodeGroups } from './BarcodeDisplay';

interface CardViewModalProps {
  card: LoyaltyCard;
  onClose: () => void;
  onEdit: (card: LoyaltyCard) => void;
  onDelete: (cardId: string) => void;
  onToggleFavorite: (cardId: string) => void;
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function CardViewModal({
  card,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
}: CardViewModalProps) {
  const [copied, setCopied] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [landscapeMode, setLandscapeMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activePhoto, setActivePhoto] = useState<'front' | 'back' | null>(null);

  // Mantiene lo schermo acceso alla cassa tramite Screen Wake Lock API
  useEffect(() => {
    let sentinel: WakeLockSentinelLike | null = null;
    let released = false;

    const requestLock = async () => {
      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (nav.wakeLock && !released) {
          sentinel = await nav.wakeLock.request('screen');
          if (!released) {
            setWakeLockActive(true);
          }
        }
      } catch {
        setWakeLockActive(false);
      }
    };

    requestLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (sentinel) {
        sentinel.release().catch(() => {});
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(card.cardNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback silenzioso se clipboard non autorizzata
    }
  };

  const hasPhotos = Boolean(card.frontImage || card.backImage);
  const photoSrc = activePhoto === 'front' ? card.frontImage : activePhoto === 'back' ? card.backImage : undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 safe-top safe-bottom">
      {/* Header colorato in stile Apple/Google Wallet */}
      <header
        className="relative px-4 pt-3 pb-5 shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${card.color} 0%, #0f172a 140%)`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md active:scale-95 transition-transform"
            aria-label="Torna alle carte"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>

          <div className="flex items-center gap-2">
            {wakeLockActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium text-amber-200 backdrop-blur-md">
                <Sun className="h-3.5 w-3.5" />
                Schermo attivo
              </span>
            )}

            <button
              type="button"
              onClick={() => onToggleFavorite(card.id)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md active:scale-95 transition-transform"
              aria-label={card.isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
            >
              <Star
                className={`h-5 w-5 ${card.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-white'}`}
              />
            </button>

            <button
              type="button"
              onClick={() => onEdit(card)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md active:scale-95 transition-transform"
              aria-label="Modifica carta"
            >
              <Edit3 className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-3 px-1">
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-sm">
            {card.storeName}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-white/85">
            {card.holderName && <span>Intestatario: {card.holderName}</span>}
            {card.holderName && <span>•</span>}
            <span>Formato: {card.barcodeFormat}</span>
          </div>
        </div>
      </header>

      {/* Corpo centrale: Barcode ad alta visibilità su bianco puro */}
      <main className="flex-1 overflow-y-auto px-4 py-5 flex flex-col items-center justify-between gap-4 max-w-lg w-full mx-auto">
        <div className="w-full rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Mostra alla cassa
            </span>
            <button
              type="button"
              onClick={() => setLandscapeMode(true)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 active:scale-95 transition-transform"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Schermo intero
            </button>
          </div>

          <BarcodeDisplay
            code={card.cardNumber}
            format={card.barcodeFormat}
            height={130}
            className="w-full py-2"
          />

          <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-100 px-4 py-3">
            <span className="font-mono text-lg sm:text-xl font-bold tracking-wider text-slate-900 select-all break-all">
              {formatCodeGroups(card.cardNumber)}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  Copiato
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copia
                </>
              )}
            </button>
          </div>
        </div>

        {/* Foto tessera / Screenshot originale se salvato */}
        {hasPhotos && (
          <div className="w-full rounded-2xl bg-slate-900/90 border border-slate-800 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              <ImageIcon className="h-4 w-4 text-indigo-400" />
              Immagini allegate
            </div>
            <div className="grid grid-cols-2 gap-3">
              {card.frontImage && (
                <button
                  type="button"
                  onClick={() => setActivePhoto('front')}
                  className="group relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1.5 text-left active:scale-95 transition-transform"
                >
                  <img
                    src={card.frontImage}
                    alt="Fronte carta"
                    className="h-24 w-full rounded-lg object-cover"
                  />
                  <span className="mt-1.5 block text-center text-xs font-medium text-slate-300">
                    {card.source === 'klarna' ? 'Screenshot Klarna' : 'Foto Fronte'}
                  </span>
                </button>
              )}
              {card.backImage && (
                <button
                  type="button"
                  onClick={() => setActivePhoto('back')}
                  className="group relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1.5 text-left active:scale-95 transition-transform"
                >
                  <img
                    src={card.backImage}
                    alt="Retro carta"
                    className="h-24 w-full rounded-lg object-cover"
                  />
                  <span className="mt-1.5 block text-center text-xs font-medium text-slate-300">
                    Foto Retro
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Note e statistiche + Eliminazione sicura */}
        <div className="w-full space-y-3 pb-2">
          {card.notes && (
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 px-4 py-3 text-sm text-slate-300">
              <span className="block text-xs font-semibold text-slate-500 mb-1">Note</span>
              {card.notes}
            </div>
          )}

          <div className="flex items-center justify-between px-1 text-xs text-slate-500">
            <span>Usata {card.usageCount} {card.usageCount === 1 ? 'volta' : 'volte'}</span>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-rose-400 hover:bg-rose-950/50 active:scale-95 transition-transform"
              >
                <Trash2 className="h-4 w-4" />
                Elimina carta
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[44px] rounded-xl bg-slate-800 px-3 text-slate-200 font-medium"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(card.id)}
                  className="min-h-[44px] rounded-xl bg-rose-600 px-3.5 text-white font-semibold"
                >
                  Conferma elimina
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modalità Landscape Full-Screen per lettori laser in cassa */}
      {landscapeMode && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-white text-slate-900"
          onClick={() => setLandscapeMode(false)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLandscapeMode(false);
            }}
            className="fixed top-4 right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg safe-top"
            aria-label="Chiudi schermo intero"
          >
            <Minimize2 className="h-5 w-5" />
          </button>

          <div className="flex flex-col items-center justify-center rotate-90 w-[85dvh] max-w-[560px]">
            <p className="mb-2 text-base font-bold text-slate-700">{card.storeName}</p>
            <BarcodeDisplay
              code={card.cardNumber}
              format={card.barcodeFormat}
              height={150}
              className="w-full"
            />
            <p className="mt-2 font-mono text-2xl font-bold tracking-widest text-slate-950">
              {formatCodeGroups(card.cardNumber)}
            </p>
          </div>
        </div>
      )}

      {/* Lightbox per vedere foto originale o screenshot Klarna */}
      {activePhoto && photoSrc && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/95 safe-top safe-bottom"
          onClick={() => setActivePhoto(null)}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold text-white">
              {activePhoto === 'front'
                ? card.source === 'klarna'
                  ? 'Screenshot originale Klarna'
                  : 'Foto Fronte'
                : 'Foto Retro'}
            </span>
            <button
              type="button"
              onClick={() => setActivePhoto(null)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white"
              aria-label="Chiudi immagine"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              src={photoSrc}
              alt="Dettaglio tessera"
              className="max-h-full max-w-full rounded-xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
