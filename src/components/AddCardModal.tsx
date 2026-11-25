import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  DecodeHintType,
} from '@zxing/library';
import {
  Camera,
  CheckCircle2,
  FlipHorizontal,
  ImagePlus,
  Keyboard,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { ITALIAN_STORES, matchStoreFromText, type StorePreset } from '../data/italianStores';
import {
  compressImage,
  decodeBarcodeFromImage,
  mapZXingFormatToType,
  normalizeDecodedBarcode,
} from '../services/barcodeScanner';
import { createCardId } from '../services/db';
import {
  BARCODE_FORMAT_OPTIONS,
  CARD_COLORS,
  CATEGORY_OPTIONS,
  type BarcodeFormatType,
  type CardCategory,
  type CardSource,
  type LoyaltyCard,
} from '../types/card';
import { BarcodeDisplay } from './BarcodeDisplay';

type EntryTab = 'camera' | 'photo' | 'manual';

interface AddCardModalProps {
  initialTab?: EntryTab;
  editingCard?: LoyaltyCard | null;
  onClose: () => void;
  onSave: (card: LoyaltyCard) => Promise<void> | void;
}

export function AddCardModal({
  initialTab = 'camera',
  editingCard = null,
  onClose,
  onSave,
}: AddCardModalProps) {
  const [activeTab, setActiveTab] = useState<EntryTab>(editingCard ? 'manual' : initialTab);

  // Campi carta
  const [storeName, setStoreName] = useState(editingCard?.storeName || '');
  const [cardNumber, setCardNumber] = useState(editingCard?.cardNumber || '');
  const [barcodeFormat, setBarcodeFormat] = useState<BarcodeFormatType>(
    editingCard?.barcodeFormat || 'EAN13'
  );
  const [color, setColor] = useState(editingCard?.color || '#2563eb');
  const [category, setCategory] = useState<CardCategory>(editingCard?.category || 'supermarket');
  const [holderName, setHolderName] = useState(editingCard?.holderName || '');
  const [notes, setNotes] = useState(editingCard?.notes || '');
  const [frontImage, setFrontImage] = useState<string | undefined>(editingCard?.frontImage);
  const [backImage, setBackImage] = useState<string | undefined>(editingCard?.backImage);
  const [source, setSource] = useState<CardSource>(editingCard?.source || 'manual');

  // Stati scanner e UI
  const [storeSearch, setStoreSearch] = useState('');
  const [showStorePicker, setShowStorePicker] = useState(!editingCard && !storeName);
  const [cameraStatus, setCameraStatus] = useState<'starting' | 'active' | 'error'>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);
  const [photoProcessing, setPhotoProcessing] = useState<'front' | 'back' | null>(null);
  const [photoFeedback, setPhotoFeedback] = useState<string | null>(null);
  const [formatLockedByScan, setFormatLockedByScan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  const stopLiveCamera = () => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch {
        // Ignora errori di reset
      }
      readerRef.current = null;
    }
    const videoEl = videoRef.current;
    if (videoEl && videoEl.srcObject) {
      const stream = videoEl.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoEl.srcObject = null;
    }
  };

  useEffect(() => {
    if (activeTab !== 'camera') {
      stopLiveCamera();
      return;
    }

    let cancelled = false;
    setCameraStatus('starting');
    setCameraError(null);

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraStatus('error');
        setCameraError(
          'Fotocamera live non disponibile su questo browser o connessione non HTTPS. Usa "Fotografa tessera" qui a fianco!'
        );
        return;
      }

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.TRY_HARDER, true);
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
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
      ]);

      const reader = new BrowserMultiFormatReader(hints, 250);
      readerRef.current = reader;

      const videoEl = videoRef.current;
      if (!videoEl) return;

      try {
        await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoEl,
          (result, _err) => {
            if (cancelled || !result) return;
            const rawCode = result.getText()?.trim();
            if (!rawCode) return;

            const normalized = normalizeDecodedBarcode(
              rawCode,
              mapZXingFormatToType(result.getBarcodeFormat())
            );
            const code = normalized.code;
            const detectedFormat = normalized.format;
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate(60);
            }

            setCardNumber(code);
            setBarcodeFormat(detectedFormat);
            setFormatLockedByScan(true);
            setSource('camera');
            setScanSuccessMsg(`Codice letto: ${code} (${detectedFormat})`);
            stopLiveCamera();
            setActiveTab('manual');
          }
        );

        if (!cancelled) {
          setCameraStatus('active');
        } else {
          stopLiveCamera();
        }
      } catch (err) {
        if (!cancelled) {
          setCameraStatus('error');
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
            setCameraError(
              'Permesso fotocamera negato. Puoi comunque usare "Fotografa tessera" per scattare una foto o sceglierla dalla galleria.'
            );
          } else {
            setCameraError(
              'Impossibile avviare la scansione dal vivo su questo dispositivo. Usa "Fotografa tessera" o inserisci il codice manualmente.'
            );
          }
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopLiveCamera();
    };
  }, [activeTab]);

  const filteredStores = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return ITALIAN_STORES;
    return ITALIAN_STORES.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [storeSearch]);

  const applyStorePreset = (preset: StorePreset) => {
    setStoreName(preset.name);
    setColor(preset.color);
    setCategory(preset.category);
    if (!formatLockedByScan && !editingCard) {
      setBarcodeFormat(preset.defaultFormat);
    }
    setShowStorePicker(false);
    setFormError(null);
  };

  const handlePhotoUpload = async (side: 'front' | 'back', file: File | undefined) => {
    if (!file) return;
    setPhotoProcessing(side);
    setPhotoFeedback(null);

    try {
      const [compressed, decoded] = await Promise.all([
        compressImage(file, 1200, 0.8),
        decodeBarcodeFromImage(file).catch(() => null),
      ]);

      if (side === 'front') {
        setFrontImage(compressed);
      } else {
        setBackImage(compressed);
      }

      if (decoded?.code) {
        setCardNumber(decoded.code);
        setBarcodeFormat(decoded.format);
        setFormatLockedByScan(true);
        setSource('photo');
        setScanSuccessMsg(`Codice letto dalla foto: ${decoded.code} (${decoded.format})`);
        setPhotoFeedback(
          `Codice a barre rilevato (${decoded.code})! Ora verifica il negozio e salva.`
        );

        // Se non è stato ancora scelto il negozio, prova dal nome file
        if (!storeName) {
          const storeFromFilename = matchStoreFromText(file.name);
          if (storeFromFilename) {
            applyStorePreset(storeFromFilename);
          }
        }
      } else {
        if (!source || source === 'manual') {
          setSource('photo');
        }
        setPhotoFeedback(
          side === 'front'
            ? 'Foto fronte salvata. Se il codice a barre è sul retro, fotografa anche il retro o inserisci il codice nei dettagli.'
            : 'Foto retro salvata. Se il codice non è stato letto automaticamente, puoi digitarlo nei dettagli.'
        );
      }
    } catch {
      setPhotoFeedback('Errore durante l’elaborazione della foto. Riprova con un’immagine più nitida.');
    } finally {
      setPhotoProcessing(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanStore = storeName.trim();
    const rawCode = cardNumber.trim();
    const numericFormats = new Set<BarcodeFormatType>(['EAN13', 'EAN8', 'UPC', 'ITF']);
    const cleanCode = numericFormats.has(barcodeFormat) ? rawCode.replace(/[\s-]+/g, '') : rawCode;

    if (!cleanStore) {
      setFormError('Inserisci o seleziona il nome del negozio.');
      return;
    }
    if (!cleanCode) {
      setFormError('Inserisci il codice a barre o il numero della tessera.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const cardToSave: LoyaltyCard = {
        id: editingCard?.id || createCardId(),
        storeName: cleanStore,
        cardNumber: cleanCode,
        barcodeFormat,
        color,
        category,
        holderName: holderName.trim() || undefined,
        notes: notes.trim() || undefined,
        isFavorite: editingCard?.isFavorite ?? false,
        usageCount: editingCard?.usageCount ?? 0,
        lastUsedAt: editingCard?.lastUsedAt,
        createdAt: editingCard?.createdAt ?? Date.now(),
        frontImage,
        backImage,
        source: editingCard?.source || source,
      };
      await onSave(cardToSave);
      onClose();
    } catch {
      setFormError('Impossibile salvare la carta sul dispositivo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 safe-top safe-bottom">
      {/* Header fisso */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur-md">
        <div>
          <h2 className="text-lg font-bold text-white">
            {editingCard ? 'Modifica Carta' : 'Nuova Carta Fedeltà'}
          </h2>
          <p className="text-xs text-slate-400">
            {editingCard
              ? 'Aggiorna codice, negozio o foto della tessera'
              : 'Scansiona, fotografa o digita il codice'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            stopLiveCamera();
            onClose();
          }}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-slate-300 active:scale-95 transition-transform"
          aria-label="Chiudi"
        >
          <X className="h-6 w-6" />
        </button>
      </header>

      {/* Selettore modalità di inserimento */}
      {!editingCard && (
        <div className="grid grid-cols-3 gap-2 border-b border-slate-800/80 bg-slate-900/60 p-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('camera')}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold transition-all ${
              activeTab === 'camera'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Camera className="h-4 w-4" />
            <span>Scansiona live</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('photo')}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold transition-all ${
              activeTab === 'photo'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImagePlus className="h-4 w-4" />
            <span>Fotografa</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold transition-all ${
              activeTab === 'manual'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Keyboard className="h-4 w-4" />
            <span>Dati / Manuale</span>
          </button>
        </div>
      )}

      {/* Contenuto principale */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'camera' && (
          <div className="flex flex-col items-center justify-between p-4 min-h-full gap-4 max-w-lg mx-auto">
            <div className="relative w-full aspect-[3/4] max-h-[60dvh] overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
                autoPlay
              />

              {/* Mirino scanner */}
              {cameraStatus !== 'error' && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="h-40 w-4/5 max-w-xs rounded-2xl border-2 border-indigo-400 shadow-[0_0_0_9999px_rgba(2,6,23,0.55)] relative">
                    <div className="absolute inset-x-2 top-1/2 h-0.5 bg-rose-500/90 shadow-[0_0_8px_#f43f5e]" />
                  </div>
                  <span className="mt-4 rounded-full bg-black/70 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-md">
                    Inquadra il codice a barre o QR della tessera
                  </span>
                </div>
              )}

              {cameraStatus === 'starting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-slate-300">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                  <span className="mt-2 text-sm">Avvio fotocamera...</span>
                </div>
              )}

              {cameraStatus === 'error' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-900">
                  <Camera className="h-12 w-12 text-slate-500 mb-3" />
                  <p className="text-sm text-slate-200 font-medium">{cameraError}</p>
                  <div className="mt-5 flex flex-col gap-2.5 w-full max-w-xs">
                    <button
                      type="button"
                      onClick={() => setActiveTab('photo')}
                      className="min-h-[48px] rounded-xl bg-indigo-600 px-4 font-semibold text-white active:scale-95 transition-transform"
                    >
                      Fotografa la tessera
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('manual')}
                      className="min-h-[48px] rounded-xl bg-slate-800 px-4 font-medium text-slate-200 active:scale-95 transition-transform"
                    >
                      Inserisci manualmente
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="w-full rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 text-center text-xs text-slate-400">
              Suggerimento: se la tessera è consumata o lucida, usa{' '}
              <button
                type="button"
                onClick={() => setActiveTab('photo')}
                className="font-semibold text-indigo-400 underline"
              >
                Fotografa
              </button>{' '}
              per scattare una foto nitida fronte e retro.
            </div>
          </div>
        )}

        {activeTab === 'photo' && (
          <div className="p-4 space-y-4 max-w-lg mx-auto">
            <div className="rounded-2xl bg-indigo-950/40 border border-indigo-500/30 p-4 text-sm text-indigo-100">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
                <div>
                  <p className="font-semibold">Lettura automatica dalla foto</p>
                  <p className="mt-1 text-xs text-indigo-200/80">
                    Scatta una foto o scegli dalla galleria. L’app legge automaticamente il codice a barre e conserva la foto di fronte e retro sul telefono.
                  </p>
                </div>
              </div>
            </div>

            {photoFeedback && (
              <div className="rounded-2xl bg-slate-900 border border-emerald-500/40 p-3.5 text-sm text-emerald-300 flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
                <span>{photoFeedback}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Foto Fronte */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-white">1. Foto Fronte</span>
                  {frontImage && (
                    <button
                      type="button"
                      onClick={() => setFrontImage(undefined)}
                      className="text-xs text-rose-400 flex items-center gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Rimuovi
                    </button>
                  )}
                </div>

                {frontImage ? (
                  <img
                    src={frontImage}
                    alt="Anteprima fronte"
                    className="h-36 w-full rounded-xl object-cover border border-slate-700"
                  />
                ) : (
                  <div className="h-36 w-full rounded-xl border border-dashed border-slate-700 bg-slate-950/60 flex flex-col items-center justify-center text-slate-500 text-xs">
                    <Camera className="h-7 w-7 mb-1.5" />
                    Nessuna foto fronte
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white active:scale-95 transition-transform">
                    {photoProcessing === 'front' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                    Scatta
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        handlePhotoUpload('front', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200 active:scale-95 transition-transform">
                    <ImagePlus className="h-4 w-4" />
                    Galleria
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handlePhotoUpload('front', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Foto Retro */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-white">2. Foto Retro (Barcode)</span>
                  {backImage && (
                    <button
                      type="button"
                      onClick={() => setBackImage(undefined)}
                      className="text-xs text-rose-400 flex items-center gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Rimuovi
                    </button>
                  )}
                </div>

                {backImage ? (
                  <img
                    src={backImage}
                    alt="Anteprima retro"
                    className="h-36 w-full rounded-xl object-cover border border-slate-700"
                  />
                ) : (
                  <div className="h-36 w-full rounded-xl border border-dashed border-slate-700 bg-slate-950/60 flex flex-col items-center justify-center text-slate-500 text-xs">
                    <FlipHorizontal className="h-7 w-7 mb-1.5" />
                    Nessuna foto retro
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white active:scale-95 transition-transform">
                    {photoProcessing === 'back' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                    Scatta
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        handlePhotoUpload('back', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200 active:scale-95 transition-transform">
                    <ImagePlus className="h-4 w-4" />
                    Galleria
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        handlePhotoUpload('back', e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className="w-full min-h-[52px] rounded-2xl bg-emerald-600 px-5 font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
            >
              {cardNumber
                ? 'Prosegui e salva la carta →'
                : 'Vai ai dettagli per inserire il nome/codice →'}
            </button>
          </div>
        )}

        {activeTab === 'manual' && (
          <form onSubmit={handleSubmit} className="p-4 space-y-5 max-w-lg mx-auto pb-8">
            {scanSuccessMsg && (
              <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 px-4 py-3 text-sm text-emerald-200">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                <span className="font-medium">{scanSuccessMsg}</span>
              </div>
            )}

            {formError && (
              <div className="rounded-2xl bg-rose-950/70 border border-rose-500/50 px-4 py-3 text-sm text-rose-200">
                {formError}
              </div>
            )}

            {/* Selettore rapido negozi italiani */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Negozio / Catena *
                </label>
                <button
                  type="button"
                  onClick={() => setShowStorePicker((v) => !v)}
                  className="text-xs font-semibold text-indigo-400"
                >
                  {showStorePicker ? 'Nascondi lista' : 'Scegli da lista negozi'}
                </button>
              </div>

              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Es. Esselunga, Conad, Coop, Decathlon..."
                className="w-full min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900 px-4 text-base text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                required
              />

              {showStorePicker && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-3 space-y-2.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={storeSearch}
                      onChange={(e) => setStoreSearch(e.target.value)}
                      placeholder="Cerca catena italiana..."
                      className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                    {filteredStores.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyStorePreset(preset)}
                        className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 active:scale-95 transition-transform"
                      >
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: preset.color }}
                        />
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Codice carta + Anteprima live */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Codice a barre / Numero Tessera *
              </label>
              <input
                type="text"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="Es. 0401234567890"
                className="w-full min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900 px-4 font-mono text-base text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                required
              />

              {cardNumber.trim() && (
                <div className="rounded-2xl bg-white p-3">
                  <BarcodeDisplay
                    code={cardNumber}
                    format={barcodeFormat}
                    height={70}
                    compact
                  />
                </div>
              )}
            </div>

            {/* Formato e Categoria */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Formato Codice
                </label>
                <select
                  value={barcodeFormat}
                  onChange={(e) => {
                    setBarcodeFormat(e.target.value as BarcodeFormatType);
                    setFormatLockedByScan(true);
                  }}
                  className="w-full min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900 px-3.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  {BARCODE_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Categoria
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CardCategory)}
                  className="w-full min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900 px-3.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Colore tessera */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Colore Tessera
              </label>
              <div className="flex flex-wrap gap-2.5">
                {CARD_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setColor(hex)}
                    className={`h-10 w-10 rounded-full transition-transform active:scale-90 ${
                      color.toLowerCase() === hex.toLowerCase()
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-110'
                        : 'opacity-80'
                    }`}
                    style={{ backgroundColor: hex }}
                    aria-label={`Seleziona colore ${hex}`}
                  />
                ))}
              </div>
            </div>

            {/* Intestatario & Note */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Intestatario (opzionale)
                </label>
                <input
                  type="text"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                  placeholder="Es. Marino"
                  className="w-full min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900 px-4 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Note (opzionale)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Es. PIN, scadenza punti..."
                  className="w-full min-h-[48px] rounded-2xl border border-slate-700 bg-slate-900 px-4 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Riepilogo foto allegate + bottone rapido per aggiungerle in modifica */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3.5 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                <p className="font-semibold text-slate-200">Foto della tessera</p>
                <p>
                  {frontImage || backImage
                    ? `${frontImage ? 'Fronte allegato' : ''}${frontImage && backImage ? ' + ' : ''}${backImage ? 'Retro allegato' : ''}`
                    : 'Nessuna foto allegata (opzionale)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('photo')}
                className="min-h-[44px] shrink-0 rounded-xl bg-slate-800 px-3.5 text-xs font-semibold text-indigo-300 active:scale-95 transition-transform"
              >
                {frontImage || backImage ? 'Gestisci foto' : 'Allega foto'}
              </button>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[52px] rounded-2xl bg-indigo-600 px-5 text-base font-bold text-white shadow-lg shadow-indigo-950/50 active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {saving ? 'Salvataggio in corso...' : editingCard ? 'Salva modifiche' : 'Salva nel Wallet'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
