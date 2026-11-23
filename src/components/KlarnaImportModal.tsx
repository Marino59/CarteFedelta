import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FolderUp,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { ITALIAN_STORES, matchStoreFromText } from '../data/italianStores';
import {
  analyzeKlarnaScreenshot,
  terminateOcrWorker,
  type KlarnaImportCandidate,
} from '../services/barcodeScanner';
import { createCardId } from '../services/db';
import {
  detectBestBarcodeFormat,
  normalizePastedCode,
  parseKlarnaPastedText,
} from '../services/klarnaPasteParser';
import { BARCODE_FORMAT_OPTIONS, type BarcodeFormatType, type LoyaltyCard } from '../types/card';
import { BarcodeDisplay } from './BarcodeDisplay';

interface KlarnaImportModalProps {
  onClose: () => void;
  onImportCards: (cards: LoyaltyCard[]) => Promise<void> | void;
}

interface EditableCandidate extends KlarnaImportCandidate {
  included: boolean;
}

type ImportModeTab = 'paste' | 'images';

export function KlarnaImportModal({ onClose, onImportCards }: KlarnaImportModalProps) {
  const [activeTab, setActiveTab] = useState<ImportModeTab>('paste');
  const [candidates, setCandidates] = useState<EditableCandidate[]>([]);

  // Inserimento rapido 1-click
  const [quickStore, setQuickStore] = useState('');
  const [quickCode, setQuickCode] = useState('');
  const [showQuickSuggestions, setShowQuickSuggestions] = useState(false);

  // Area incolla testo/elenco
  const [bulkText, setBulkText] = useState('');
  const [pasteNotice, setPasteNotice] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(
    null
  );

  // Stato analisi immagini
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [keepScreenshots, setKeepScreenshots] = useState(true);
  const [saving, setSaving] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const processImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    setAnalyzing(true);
    setProgress({ current: 0, total: files.length });

    const newResults: EditableCandidate[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tempId = `klarna-img-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        const result = await analyzeKlarnaScreenshot(file, tempId);
        newResults.push({
          ...result,
          included: true,
        });
      } catch {
        newResults.push({
          tempId,
          fileName: file.name,
          previewImage: '',
          cardNumber: '',
          barcodeFormat: 'CODE128',
          storeName: '',
          color: '#2563eb',
          category: 'other',
          matchedStore: null,
          status: 'needs_code',
          included: true,
        });
      }
      setProgress({ current: i + 1, total: files.length });
    }

    setCandidates((prev) => [...newResults, ...prev]);
    setAnalyzing(false);
  }, []);

  // Listener globale Ctrl+V per intercettare immagini incollate dagli appunti (es. Win+Shift+S su PC)
  useEffect(() => {
    const handleGlobalPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        setPasteNotice({
          type: 'info',
          text: `Immagine incollata dagli appunti! Lettura codice a barre in corso...`,
        });
        await processImageFiles(imageFiles);
        setPasteNotice({
          type: 'ok',
          text: 'Immagine elaborata e aggiunta alla lista qui sotto!',
        });
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => {
      window.removeEventListener('paste', handleGlobalPaste);
      terminateOcrWorker().catch(() => {});
    };
  }, [processImageFiles]);

  const quickSuggestions = useMemo(() => {
    const q = quickStore.trim().toLowerCase();
    if (!q) return ITALIAN_STORES.slice(0, 10);
    return ITALIAN_STORES.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [quickStore]);

  const handleAddQuickCard = (e?: React.FormEvent) => {
    e?.preventDefault();
    const rawStore = quickStore.trim();
    const cleanCode = normalizePastedCode(quickCode);

    if (!rawStore) {
      setPasteNotice({ type: 'err', text: 'Scrivi o scegli il nome del negozio.' });
      return;
    }
    if (!cleanCode) {
      setPasteNotice({ type: 'err', text: 'Incolla o digita il codice della tessera.' });
      return;
    }

    const matchedStore = matchStoreFromText(rawStore);
    const barcodeFormat = detectBestBarcodeFormat(cleanCode, matchedStore);
    const tempId = `klarna-quick-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const newCandidate: EditableCandidate = {
      tempId,
      fileName: 'Copia & Incolla',
      previewImage: '',
      cardNumber: cleanCode,
      barcodeFormat,
      storeName: matchedStore?.name || rawStore,
      color: matchedStore?.color || '#2563eb',
      category: matchedStore?.category || 'other',
      matchedStore,
      status: 'decoded',
      included: true,
    };

    setCandidates((prev) => [newCandidate, ...prev]);
    setQuickStore('');
    setQuickCode('');
    setShowQuickSuggestions(false);
    setPasteNotice({
      type: 'ok',
      text: `Aggiunta "${newCandidate.storeName}" (${barcodeFormat})! Pronto per la prossima carta.`,
    });
  };

  const handlePasteQuickCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const cleaned = normalizePastedCode(text);
      if (!cleaned) {
        setPasteNotice({ type: 'err', text: 'Gli appunti non contengono testo.' });
        return;
      }
      setQuickCode(cleaned);
      setPasteNotice(null);
    } catch {
      setPasteNotice({
        type: 'info',
        text: 'Accesso diretto agli appunti bloccato: fai clic nel campo codice e premi Ctrl+V.',
      });
    }
  };

  const extractFromBulkText = (textToParse: string) => {
    const parsed = parseKlarnaPastedText(textToParse);
    if (parsed.length === 0) {
      setPasteNotice({
        type: 'err',
        text: 'Nessun codice trovato nel testo. Assicurati che ci sia il nome del negozio e il numero della carta.',
      });
      return;
    }

    const now = Date.now();
    const mapped: EditableCandidate[] = parsed.map((item, idx) => ({
      tempId: `klarna-paste-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      fileName: 'Testo incollato',
      previewImage: '',
      cardNumber: item.cardNumber,
      barcodeFormat: item.barcodeFormat,
      storeName: item.storeName,
      color: item.color,
      category: item.category,
      matchedStore: item.matchedStore,
      status: 'decoded',
      included: true,
    }));

    setCandidates((prev) => [...mapped, ...prev]);
    setBulkText('');
    setPasteNotice({
      type: 'ok',
      text: `Estratte ${mapped.length} ${mapped.length === 1 ? 'carta' : 'carte'} dal testo incollato! Controlla l'anteprima qui sotto.`,
    });
  };

  const handleClipboardBulkPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setPasteNotice({ type: 'err', text: 'Gli appunti sono vuoti.' });
        return;
      }
      extractFromBulkText(text);
    } catch {
      setPasteNotice({
        type: 'info',
        text: 'Incolla con Ctrl+V dentro il riquadro qui sotto, poi premi "Estrai carte dal testo".',
      });
    }
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|bmp)$/i.test(f.name)
    );
    await processImageFiles(files);
  };

  const updateCandidate = (tempId: string, patch: Partial<EditableCandidate>) => {
    setCandidates((prev) =>
      prev.map((item) => {
        if (item.tempId !== tempId) return item;
        const updated = { ...item, ...patch };
        if (patch.storeName !== undefined) {
          const matched = matchStoreFromText(patch.storeName);
          if (matched) {
            updated.color = matched.color;
            updated.category = matched.category;
            updated.matchedStore = matched;
          }
        }
        return updated;
      })
    );
  };

  const selectPresetForCandidate = (tempId: string, storeId: string) => {
    const preset = ITALIAN_STORES.find((s) => s.id === storeId);
    if (!preset) return;
    setCandidates((prev) =>
      prev.map((item) =>
        item.tempId === tempId
          ? {
              ...item,
              storeName: preset.name,
              color: preset.color,
              category: preset.category,
              matchedStore: preset,
            }
          : item
      )
    );
  };

  const removeCandidate = (tempId: string) => {
    setCandidates((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  const readyToSave = candidates.filter(
    (c) => c.included && c.storeName.trim().length > 0 && c.cardNumber.trim().length > 0
  );
  const hasAnyPreviewImages = candidates.some((c) => Boolean(c.previewImage));

  const handleSaveAll = async () => {
    if (readyToSave.length === 0) return;
    setSaving(true);
    try {
      const now = Date.now();
      const cards: LoyaltyCard[] = readyToSave.map((item, idx) => ({
        id: createCardId(),
        storeName: item.storeName.trim(),
        cardNumber: item.cardNumber.trim(),
        barcodeFormat: item.barcodeFormat,
        color: item.color,
        category: item.category,
        isFavorite: false,
        usageCount: 0,
        createdAt: now + idx,
        frontImage: keepScreenshots && item.previewImage ? item.previewImage : undefined,
        source: 'klarna',
      }));
      await onImportCards(cards);
      await terminateOcrWorker();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 safe-top safe-bottom">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur-md">
        <div>
          <h2 className="text-lg font-bold text-white">Trasferisci da Klarna</h2>
          <p className="text-xs text-slate-400">
            Copia e incolla dal PC oppure carica foto dei codici
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-slate-300 active:scale-95 transition-transform"
          aria-label="Chiudi"
        >
          <X className="h-6 w-6" />
        </button>
      </header>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 border-b border-slate-800/80 bg-slate-900/60 p-2.5">
        <button
          type="button"
          onClick={() => setActiveTab('paste')}
          className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition-all ${
            activeTab === 'paste'
              ? 'bg-pink-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          <ClipboardPaste className="h-4 w-4" />
          <span>Copia e Incolla da PC</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('images')}
          className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition-all ${
            activeTab === 'images'
              ? 'bg-pink-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          <ImagePlus className="h-4 w-4" />
          <span>Carica Foto / Immagini</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl w-full mx-auto pb-28">
        {pasteNotice && (
          <div
            className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs ${
              pasteNotice.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                : pasteNotice.type === 'err'
                  ? 'border-rose-500/40 bg-rose-950/50 text-rose-200'
                  : 'border-indigo-500/40 bg-indigo-950/50 text-indigo-200'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{pasteNotice.text}</span>
          </div>
        )}

        {activeTab === 'paste' ? (
          <div className="space-y-4">
            {/* Inserimento rapido 1-click Negozio + Codice */}
            <form
              onSubmit={handleAddQuickCard}
              className="rounded-3xl border border-slate-800 bg-slate-900 p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Sparkles className="h-4 w-4 text-pink-400" />
                Inserimento rapido da PC (1 carta alla volta)
              </div>

              <div className="relative space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Negozio
                </label>
                <input
                  type="text"
                  value={quickStore}
                  onFocus={() => setShowQuickSuggestions(true)}
                  onChange={(e) => {
                    setQuickStore(e.target.value);
                    setShowQuickSuggestions(true);
                  }}
                  placeholder="Es. Esselunga, Conad, Lidl, IKEA..."
                  className="w-full min-h-[46px] rounded-xl border border-slate-700 bg-slate-950 px-3.5 text-sm text-white placeholder:text-slate-500 focus:border-pink-500 focus:outline-none"
                />
                {showQuickSuggestions && quickSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {quickSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setQuickStore(s.name);
                          setShowQuickSuggestions(false);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 active:scale-95 transition-transform"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Codice carta copiato da Klarna
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={quickCode}
                    onChange={(e) => setQuickCode(e.target.value)}
                    placeholder="Incolla il numero (es. 0401 2345 6789 0)"
                    className="flex-1 min-h-[46px] rounded-xl border border-slate-700 bg-slate-950 px-3.5 font-mono text-sm text-white placeholder:text-slate-500 focus:border-pink-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePasteQuickCode}
                    className="flex min-h-[46px] shrink-0 items-center gap-1.5 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200 active:scale-95 transition-transform"
                  >
                    <ClipboardPaste className="h-4 w-4 text-pink-400" />
                    Incolla
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-pink-600 px-4 text-sm font-bold text-white shadow-md active:scale-[0.98] transition-transform"
              >
                <Plus className="h-5 w-5" />
                Aggiungi alla lista e ricrea codice a barre
              </button>
            </form>

            {/* Area Incolla Testo o Elenco + Ctrl+V Immagine */}
            <div className="rounded-3xl border border-indigo-500/25 bg-gradient-to-br from-slate-900 to-indigo-950/35 p-4 space-y-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Wand2 className="h-4 w-4 text-indigo-400" />
                  Oppure incolla testo / elenco completo
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Copia da Klarna su PC (o incolla un elenco tipo <code className="text-slate-200">Esselunga 0401234567890</code> su più righe). Se premi <strong className="text-slate-200">Ctrl+V</strong> con un ritaglio immagine (<code className="text-slate-200">Win+Shift+S</code>), legge anche l’immagine!
                </p>
              </div>

              <textarea
                rows={4}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'Esempio:\nEsselunga 0401 2345 6789 0\nConad - 2901234567891\nDecathlon\n2099887766554'}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleClipboardBulkPaste}
                  className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white active:scale-95 transition-transform"
                >
                  <ClipboardPaste className="h-4 w-4" />
                  Incolla dagli appunti ed estrai
                </button>

                <button
                  type="button"
                  disabled={!bulkText.trim()}
                  onClick={() => extractFromBulkText(bulkText)}
                  className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-xs font-bold text-slate-100 active:scale-95 transition-transform disabled:opacity-45"
                >
                  <Wand2 className="h-4 w-4 text-indigo-400" />
                  Estrai carte dal testo
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Tab secondaria: Carica Foto / Immagini */
          <div className="rounded-3xl bg-gradient-to-br from-pink-950/50 via-slate-900 to-indigo-950/50 border border-pink-500/25 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-pink-200">
              <Sparkles className="h-4 w-4 text-pink-400" />
              Carica foto dello schermo o immagini salvate
            </div>
            <p className="text-xs text-slate-300">
              Poiché Klarna sul telefonino blocca gli screenshot, puoi fotografare lo schermo del PC o caricare immagini salvate sul computer (anche più file insieme, o incollando con <strong className="text-white">Ctrl+V</strong>).
            </p>

            <label className="mt-2 flex min-h-[54px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-pink-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-pink-950/50 active:scale-[0.98] transition-transform">
              {analyzing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Analisi immagini ({progress.current}/{progress.total})...
                </>
              ) : (
                <>
                  <FolderUp className="h-5 w-5" />
                  Seleziona foto o immagini dal dispositivo
                </>
              )}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={analyzing}
                className="hidden"
                onChange={(e) => {
                  handleFilesSelected(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {analyzing && (
              <div className="space-y-1.5 pt-1">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pink-500 to-indigo-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-center text-slate-400">
                  Lettura codici a barre e riconoscimento automatico negozi ({progressPct}%)...
                </p>
              </div>
            )}
          </div>
        )}

        {/* Opzione conservazione immagini (solo se ci sono anteprime immagine) */}
        {hasAnyPreviewImages && (
          <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-300 cursor-pointer">
            <span>Conserva l’immagine originale allegata alla carta</span>
            <input
              type="checkbox"
              checked={keepScreenshots}
              onChange={(e) => setKeepScreenshots(e.target.checked)}
              className="h-5 w-5 rounded accent-indigo-500"
            />
          </label>
        )}

        {/* Lista carte pronte con anteprima live del codice a barre */}
        {candidates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-bold text-white">
                Carte pronte ({candidates.length})
              </h3>
              <span className="text-xs text-emerald-400 font-medium">
                {readyToSave.length} pronte da salvare
              </span>
            </div>

            {candidates.map((item) => {
              const hasCode = item.cardNumber.trim().length > 0;
              const hasStore = item.storeName.trim().length > 0;

              return (
                <div
                  key={item.tempId}
                  className={`rounded-2xl border p-3.5 space-y-3 transition-all ${
                    !item.included
                      ? 'border-slate-800 bg-slate-900/40 opacity-55'
                      : hasCode && hasStore
                        ? 'border-emerald-500/35 bg-slate-900'
                        : 'border-amber-500/45 bg-slate-900'
                  }`}
                >
                  <div className="flex gap-3">
                    {item.previewImage && (
                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={() => setZoomedImage(item.previewImage)}
                          className="relative h-24 w-16 overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
                          title="Tocca per ingrandire"
                        >
                          <img
                            src={item.previewImage}
                            alt={item.fileName}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {hasCode ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                          )}
                          <span className="truncate text-xs font-medium text-slate-300">
                            {hasCode ? 'Codice a barre pronto' : 'Inserisci codice'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={item.included}
                            onChange={(e) =>
                              updateCandidate(item.tempId, { included: e.target.checked })
                            }
                            aria-label="Includi carta nell'importazione"
                            className="h-5 w-5 rounded accent-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={() => removeCandidate(item.tempId)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:text-rose-400"
                            aria-label="Rimuovi carta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5">
                        <div className="flex gap-1.5">
                          <span
                            className="mt-2.5 h-5 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <input
                            type="text"
                            value={item.storeName}
                            onChange={(e) =>
                              updateCandidate(item.tempId, { storeName: e.target.value })
                            }
                            placeholder="Nome negozio (es. Esselunga)"
                            className="w-full min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                          />
                        </div>

                        <select
                          value={item.matchedStore?.id || ''}
                          onChange={(e) => selectPresetForCandidate(item.tempId, e.target.value)}
                          className="w-full min-h-[38px] rounded-xl border border-slate-800 bg-slate-950/80 px-2.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Scegli negozio dalla lista italiana...</option>
                          {ITALIAN_STORES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-[1fr_auto] gap-1.5">
                        <input
                          type="text"
                          value={item.cardNumber}
                          onChange={(e) =>
                            updateCandidate(item.tempId, { cardNumber: e.target.value })
                          }
                          placeholder="Numero carta"
                          className="w-full min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                        />
                        <select
                          value={item.barcodeFormat}
                          onChange={(e) =>
                            updateCandidate(item.tempId, {
                              barcodeFormat: e.target.value as BarcodeFormatType,
                            })
                          }
                          className="min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                        >
                          {BARCODE_FORMAT_OPTIONS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Anteprima dal vivo del codice a barre generato */}
                  {hasCode && (
                    <div className="rounded-xl bg-white px-2 py-1.5">
                      <BarcodeDisplay
                        code={item.cardNumber}
                        format={item.barcodeFormat}
                        height={46}
                        compact
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer fisso per salvataggio batch */}
      {candidates.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t border-slate-800 bg-slate-950/95 p-4 backdrop-blur-md safe-bottom">
          <div className="max-w-xl mx-auto">
            <button
              type="button"
              disabled={readyToSave.length === 0 || saving || analyzing}
              onClick={handleSaveAll}
              className="w-full min-h-[52px] rounded-2xl bg-emerald-600 px-5 text-base font-bold text-white shadow-lg active:scale-[0.98] transition-transform disabled:opacity-45"
            >
              {saving
                ? 'Salvataggio in corso...'
                : readyToSave.length === 0
                  ? 'Completa negozio e codice per salvare'
                  : `Salva ${readyToSave.length} ${readyToSave.length === 1 ? 'carta' : 'carte'} nel Wallet`}
            </button>
          </div>
        </div>
      )}

      {/* Zoom immagine */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/95 p-4 safe-top safe-bottom"
          onClick={() => setZoomedImage(null)}
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setZoomedImage(null)}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white"
              aria-label="Chiudi anteprima"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-auto">
            <img
              src={zoomedImage}
              alt="Immagine ingrandita"
              className="max-h-full max-w-full rounded-xl object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
