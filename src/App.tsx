import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpDown,
  Barcode,
  Camera,
  Check,
  ChevronRight,
  CreditCard,
  FolderUp,
  GripVertical,
  HardDrive,
  ImagePlus,
  Plus,
  QrCode,
  Search,
  Sparkles,
  Star,
  WifiOff,
  X,
} from 'lucide-react';
import { AddCardModal } from './components/AddCardModal';
import { BackupModal } from './components/BackupModal';
import { formatCodeGroups } from './components/BarcodeDisplay';
import { CardViewModal } from './components/CardViewModal';
import { KlarnaImportModal } from './components/KlarnaImportModal';
import {
  deleteCard,
  getAllCards,
  incrementCardUsage,
  mergeIncomingCards,
  saveCard,
  saveMultipleCards,
  syncFromServerOrHash,
  toggleCardFavorite,
  updateCardOrders,
} from './services/db';
import { CATEGORY_OPTIONS, type CardCategory, type LoyaltyCard } from './types/card';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type SortMode = 'custom' | 'smart' | 'alpha' | 'recent';

export function App() {
  const [cards, setCards] = useState<LoyaltyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | CardCategory>('all');
  const [sortMode, setSortMode] = useState<SortMode>('custom');
  const [isReordering, setIsReordering] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  // Modali
  const [selectedCard, setSelectedCard] = useState<LoyaltyCard | null>(null);
  const [addModalState, setAddModalState] = useState<{
    open: boolean;
    initialTab: 'camera' | 'photo' | 'manual';
    editingCard: LoyaltyCard | null;
  }>({ open: false, initialTab: 'camera', editingCard: null });
  const [klarnaOpen, setKlarnaOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  // PWA Installazione & Sync LAN
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3000);
  }, []);

  const refreshCards = useCallback(async () => {
    const loaded = await getAllCards();
    setCards(loaded);
  }, []);

  useEffect(() => {
    const init = async () => {
      await refreshCards().catch(() => {});
      setLoading(false);

      try {
        const syncResult = await syncFromServerOrHash();
        if (syncResult.lanUrl) {
          setLanUrl(syncResult.lanUrl);
        }
        const totalAdded = syncResult.addedFromHash + syncResult.addedFromSync;
        if (totalAdded > 0) {
          await refreshCards();
          showToast(
            `${totalAdded} ${totalAdded === 1 ? 'carta trasferita' : 'carte trasferite'} sul dispositivo!`
          );
        }
      } catch {
        // Ignora errori di rete se offline
      }
    };
    void init();
  }, [refreshCards, showToast]);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleTriggerInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      setIsStandalone(true);
    }
  };

  const handleOpenCard = async (card: LoyaltyCard) => {
    setSelectedCard(card);
    const updated = await incrementCardUsage(card.id);
    if (updated) {
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSelectedCard(updated);
    }
  };

  const handleSaveCard = async (card: LoyaltyCard) => {
    const isEdit = Boolean(addModalState.editingCard);
    await saveCard(card);
    await refreshCards();
    if (selectedCard?.id === card.id) {
      setSelectedCard(card);
    }
    showToast(isEdit ? `Carta "${card.storeName}" aggiornata` : `Carta "${card.storeName}" salvata`);
  };

  const handleImportKlarnaCards = async (importedCards: LoyaltyCard[]) => {
    await saveMultipleCards(importedCards);
    await refreshCards();
    showToast(
      `Importate ${importedCards.length} ${importedCards.length === 1 ? 'carta' : 'carte'} da Klarna`
    );
  };

  const handleDeleteCard = async (cardId: string) => {
    await deleteCard(cardId);
    setSelectedCard(null);
    await refreshCards();
    showToast('Carta eliminata');
  };

  const handleToggleFavorite = async (cardId: string) => {
    const updated = await toggleCardFavorite(cardId);
    if (updated) {
      await refreshCards();
      if (selectedCard?.id === cardId) {
        setSelectedCard(updated);
      }
    }
  };

  const displayedCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = cards.filter((c) => {
      if (selectedCategory !== 'all' && c.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        c.storeName.toLowerCase().includes(q) ||
        c.cardNumber.toLowerCase().includes(q) ||
        (c.holderName?.toLowerCase().includes(q) ?? false) ||
        (c.notes?.toLowerCase().includes(q) ?? false)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'custom') {
        const aHasOrder = typeof a.sortOrder === 'number';
        const bHasOrder = typeof b.sortOrder === 'number';
        if (aHasOrder && bHasOrder && a.sortOrder !== b.sortOrder) {
          return a.sortOrder! - b.sortOrder!;
        }
        if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      if (sortMode === 'alpha') {
        return a.storeName.localeCompare(b.storeName, 'it');
      }
      if (sortMode === 'recent') {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      // smart: preferiti prima, poi più usate, poi più recenti
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      const usageDiff = (b.usageCount || 0) - (a.usageCount || 0);
      if (usageDiff !== 0) return usageDiff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [cards, searchQuery, selectedCategory, sortMode]);

  const cycleSortMode = () => {
    setIsReordering(false);
    setSortMode((prev) =>
      prev === 'custom'
        ? 'smart'
        : prev === 'smart'
          ? 'alpha'
          : prev === 'alpha'
            ? 'recent'
            : 'custom'
    );
  };

  const sortLabel =
    sortMode === 'custom'
      ? 'Personale'
      : sortMode === 'smart'
        ? 'Più usate'
        : sortMode === 'alpha'
          ? 'A–Z'
          : 'Recenti';

  const applyCustomOrder = async (newList: LoyaltyCard[]) => {
    const withOrder = newList.map((c, idx) => ({ ...c, sortOrder: idx }));
    setCards(withOrder);
    setSortMode('custom');
    await updateCardOrders(withOrder.map((c) => c.id));
  };

  const moveCardStep = async (cardId: string, direction: -1 | 1) => {
    const currentOrder = [...cards].sort((a, b) => {
      const aHas = typeof a.sortOrder === 'number';
      const bHas = typeof b.sortOrder === 'number';
      if (aHas && bHas && a.sortOrder !== b.sortOrder) return a.sortOrder! - b.sortOrder!;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    const idx = currentOrder.findIndex((c) => c.id === cardId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= currentOrder.length) return;
    const [moved] = currentOrder.splice(idx, 1);
    currentOrder.splice(targetIdx, 0, moved);
    await applyCustomOrder(currentOrder);
  };

  const moveCardToTarget = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const currentOrder = [...displayedCards];
    const fromIdx = currentOrder.findIndex((c) => c.id === sourceId);
    const toIdx = currentOrder.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, moved);
    // Preserva eventuali carte filtrate fuori alla fine
    const inOrderIds = new Set(currentOrder.map((c) => c.id));
    const remaining = cards.filter((c) => !inOrderIds.has(c.id));
    await applyCustomOrder([...currentOrder, ...remaining]);
  };

  const toggleReorderMode = () => {
    if (!isReordering) {
      setSearchQuery('');
      setSelectedCategory('all');
      setSortMode('custom');
      setIsReordering(true);
    } else {
      setIsReordering(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-950 text-slate-100 safe-top pb-[calc(7.25rem+env(safe-area-inset-bottom))]">
      {/* Sticky Glass Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 px-3 sm:px-4 py-3.5 backdrop-blur-md">
        <div className="mx-auto flex w-full lg:max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-md shadow-indigo-950/60">
              <Barcode className="h-7 w-7 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold tracking-tight text-white">
                Carte Fedeltà
              </h1>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>
                  {cards.length} {cards.length === 1 ? 'carta salvata' : 'carte salvate'}
                </span>
                {isOffline && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                    <WifiOff className="h-3.5 w-3.5" />
                    Offline
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={() => setBackupOpen(true)}
                className="inline-flex min-h-[56px] items-center gap-2 rounded-2xl bg-indigo-600/20 border border-indigo-500/35 px-4 text-sm sm:text-base font-bold text-indigo-200 active:scale-95 transition-transform"
                title="Passa le carte al telefonino via QR"
              >
                <QrCode className="h-6 w-6 text-indigo-400" />
                <span className="hidden sm:inline">Passa al Telefono</span>
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                setAddModalState({ open: true, initialTab: 'manual', editingCard: null })
              }
              className="flex min-h-[56px] min-w-[56px] items-center justify-center gap-1.5 rounded-2xl bg-indigo-600 px-4 text-base font-bold text-white shadow-lg active:scale-95 transition-transform"
              aria-label="Aggiungi carta"
            >
              <Plus className="h-7 w-7" />
              <span className="hidden sm:inline">Nuova</span>
            </button>
          </div>
        </div>

        {/* Barra di ricerca, Riordina e Filtri */}
        {cards.length > 0 && (
          <div className="mx-auto mt-3.5 w-full lg:max-w-3xl space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => {
                    setIsReordering(false);
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="Cerca negozio o codice..."
                  className="w-full min-h-[56px] rounded-2xl border border-slate-800 bg-slate-900/90 pl-12 pr-10 text-base text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full text-slate-400"
                    aria-label="Pulisci ricerca"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>

              {cards.length > 1 && (
                <button
                  type="button"
                  onClick={toggleReorderMode}
                  className={`flex min-h-[56px] shrink-0 items-center gap-2 rounded-2xl border px-4 text-base font-bold active:scale-95 transition-all ${
                    isReordering
                      ? 'border-emerald-500 bg-emerald-600 text-white shadow-md'
                      : 'border-slate-800 bg-slate-900 text-slate-200'
                  }`}
                >
                  {isReordering ? (
                    <>
                      <Check className="h-6 w-6" />
                      <span>Fatto</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpDown className="h-5 w-5 text-indigo-400" />
                      <span>Ordina</span>
                    </>
                  )}
                </button>
              )}

              {!isReordering && (
                <button
                  type="button"
                  onClick={cycleSortMode}
                  className="flex min-h-[56px] shrink-0 items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900 px-3.5 text-sm font-bold text-slate-300 active:scale-95 transition-transform"
                  title="Cambia ordinamento"
                >
                  <ArrowDownAZ className="h-5 w-5 text-indigo-400" />
                  <span className="hidden sm:inline">{sortLabel}</span>
                </button>
              )}
            </div>

            {isReordering ? (
              <div className="rounded-2xl border border-indigo-500/35 bg-indigo-950/40 px-4 py-3 text-sm font-medium text-indigo-200">
                Usa i pulsanti grandi <strong className="text-white">↑</strong> e{' '}
                <strong className="text-white">↓</strong> per spostare le carte nell’ordine che preferisci, poi tocca <strong className="text-white">Fatto</strong>.
              </div>
            ) : (
              /* Horizontal Snap Categories */
              <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`snap-start shrink-0 min-h-[48px] rounded-full px-5 text-sm font-bold transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  Tutte ({cards.length})
                </button>
                {CATEGORY_OPTIONS.map((cat) => {
                  const count = cards.filter((c) => c.category === cat.value).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setSelectedCategory(cat.value)}
                      className={`snap-start shrink-0 min-h-[48px] rounded-full px-5 text-sm font-bold transition-colors ${
                        selectedCategory === cat.value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {cat.label} ({count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full lg:max-w-3xl flex-1 px-3 sm:px-4 py-4">
        {loading ? (
          <div className="flex flex-col gap-3.5">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-24 animate-pulse rounded-3xl bg-slate-900 border border-slate-800"
              />
            ))}
          </div>
        ) : cards.length === 0 ? (
          /* Empty State guidato per iniziare subito */
          <div className="mt-4 space-y-4">
            <div className="rounded-3xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-center shadow-xl">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-600/20 border border-indigo-500/30">
                <CreditCard className="h-8 w-8 text-indigo-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Il tuo portafoglio carte è pronto</h2>
              <p className="mt-2 text-sm text-slate-400">
                Salva tutte le tue tessere sul telefonino in modo sicuro e offline. Mostrale alla cassa in un attimo.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-3.5 text-left">
                <button
                  type="button"
                  onClick={() =>
                    setAddModalState({ open: true, initialTab: 'photo', editingCard: null })
                  }
                  className="flex min-h-[84px] items-center gap-4 rounded-2xl bg-indigo-600 p-4 text-white shadow-lg shadow-indigo-950/60 active:scale-[0.98] transition-transform"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                    <Camera className="h-7 w-7" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">Fotografa o Scansiona</p>
                    <p className="text-xs text-indigo-100/85">
                      Legge il codice a barre dalla fotocamera o da una foto
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setKlarnaOpen(true)}
                  className="flex min-h-[84px] items-center gap-4 rounded-2xl border border-pink-500/35 bg-pink-950/35 p-4 text-white active:scale-[0.98] transition-transform"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-pink-500/25">
                    <Sparkles className="h-7 w-7 text-pink-300" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">Trasferisci da Klarna</p>
                    <p className="text-xs text-pink-200/80">
                      Copia e incolla dal PC oppure carica foto dei codici
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        ) : displayedCards.length === 0 ? (
          <div className="mt-10 text-center space-y-3">
            <p className="text-base text-slate-400">Nessuna carta trovata per la ricerca corrente.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="min-h-[52px] rounded-2xl bg-slate-800 px-6 text-sm font-bold text-white"
            >
              Mostra tutte le carte
            </button>
          </div>
        ) : (
          /* Lista a singola fila ottimizzata per telefonino */
          <div className="flex flex-col gap-3.5">
            {displayedCards.map((card, index) => (
              <div
                key={card.id}
                draggable={isReordering}
                onDragStart={() => setDraggedId(card.id)}
                onDragOver={(e) => {
                  if (isReordering) e.preventDefault();
                }}
                onDrop={() => {
                  if (isReordering && draggedId) {
                    void moveCardToTarget(draggedId, card.id);
                    setDraggedId(null);
                  }
                }}
                onDragEnd={() => setDraggedId(null)}
                onClick={() => {
                  if (!isReordering) void handleOpenCard(card);
                }}
                role={isReordering ? undefined : 'button'}
                tabIndex={isReordering ? undefined : 0}
                onKeyDown={(e) => {
                  if (!isReordering && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    void handleOpenCard(card);
                  }
                }}
                className={`group relative flex items-stretch overflow-hidden rounded-3xl border bg-slate-900 shadow-lg transition-transform min-h-[116px] ${
                  isReordering
                    ? 'border-indigo-500/45'
                    : 'border-white/10 cursor-pointer active:scale-[0.98]'
                }`}
              >
                {/* Banda laterale colore brand */}
                <div
                  className="w-4 shrink-0"
                  style={{ backgroundColor: card.color }}
                />

                {/* Badge icona/iniziale negozio */}
                <div className="flex items-center pl-4 py-3.5">
                  <div
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-extrabold text-white shadow-inner"
                    style={{
                      background: `linear-gradient(135deg, ${card.color} 0%, ${card.color}bb 100%)`,
                    }}
                  >
                    {card.storeName.trim().slice(0, 2).toUpperCase()}
                  </div>
                </div>

                {/* Testo principale della scheda */}
                <div className="flex-1 min-w-0 px-4 py-3.5 flex flex-col justify-center">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-2xl font-extrabold leading-tight text-white">
                      {card.storeName}
                    </span>
                    {card.isFavorite && !isReordering && (
                      <Star className="h-5 w-5 shrink-0 fill-amber-300 text-amber-300" />
                    )}
                  </div>

                  <p className="mt-1 truncate font-mono text-base text-slate-200">
                    {formatCodeGroups(card.cardNumber)}
                  </p>

                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <Barcode className="h-4 w-4 text-indigo-400" />
                      {card.barcodeFormat}
                    </span>
                    {card.source === 'klarna' ? (
                      <span className="rounded-md bg-pink-500/15 px-2 py-0.5 text-xs text-pink-300 font-semibold">
                        Klarna
                      </span>
                    ) : card.frontImage || card.backImage ? (
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300 font-medium">
                        Foto
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Azioni a destra: Frecce grandi in modalità Ordina oppure Stella + Freccia */}
                {isReordering ? (
                  <div className="flex items-center gap-2 pr-3.5">
                    <GripVertical className="hidden sm:block h-5 w-5 text-slate-500 mr-1" />
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        void moveCardStep(card.id, -1);
                      }}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-white active:scale-90 transition-transform disabled:opacity-30"
                      aria-label="Sposta su"
                    >
                      <ArrowUp className="h-7 w-7" />
                    </button>
                    <button
                      type="button"
                      disabled={index === displayedCards.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        void moveCardStep(card.id, 1);
                      }}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-white active:scale-90 transition-transform disabled:opacity-30"
                      aria-label="Sposta giù"
                    >
                      <ArrowDown className="h-7 w-7" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 pr-3.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleToggleFavorite(card.id);
                      }}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl text-slate-400 hover:bg-slate-800/70 active:scale-90 transition-transform"
                      aria-label={card.isFavorite ? 'Togli preferito' : 'Metti tra preferiti'}
                    >
                      <Star
                        className={`h-6 w-6 ${
                          card.isFavorite ? 'fill-amber-300 text-amber-300' : 'text-slate-500'
                        }`}
                      />
                    </button>
                    <ChevronRight className="h-6 w-6 text-slate-600" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar Ergonomica con Pulsanti Grandi (Thumb Zone) */}
      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800/80 bg-slate-950/95 backdrop-blur-lg safe-bottom">
        <div className="mx-auto flex h-[88px] w-full lg:max-w-3xl items-center justify-around gap-2 px-3">
          <button
            type="button"
            onClick={() =>
              setAddModalState({ open: true, initialTab: 'camera', editingCard: null })
            }
            className="flex flex-1 min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-slate-900/90 text-slate-100 active:scale-95 transition-transform"
          >
            <Camera className="h-7 w-7 text-indigo-400" />
            <span className="text-xs sm:text-sm font-bold">Scansiona</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setAddModalState({ open: true, initialTab: 'photo', editingCard: null })
            }
            className="flex flex-1 min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-slate-900/90 text-slate-100 active:scale-95 transition-transform"
          >
            <ImagePlus className="h-7 w-7 text-emerald-400" />
            <span className="text-xs sm:text-sm font-bold">Fotografa</span>
          </button>

          <button
            type="button"
            onClick={() => setKlarnaOpen(true)}
            className="flex flex-1 min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-slate-900/90 text-slate-100 active:scale-95 transition-transform"
          >
            <FolderUp className="h-7 w-7 text-pink-400" />
            <span className="text-xs sm:text-sm font-bold">Da Klarna</span>
          </button>

          <button
            type="button"
            onClick={() => setBackupOpen(true)}
            className="flex flex-1 min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-slate-900/90 text-slate-100 active:scale-95 transition-transform"
          >
            <HardDrive className="h-7 w-7 text-amber-400" />
            <span className="text-xs sm:text-sm font-bold">Backup</span>
          </button>
        </div>
      </nav>

      {/* Toast Feedback */}
      {toastMsg && (
        <div className="fixed top-16 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xl">
          {toastMsg}
        </div>
      )}

      {/* Modali */}
      {selectedCard && (
        <CardViewModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onEdit={(card) => {
            setAddModalState({ open: true, initialTab: 'manual', editingCard: card });
          }}
          onDelete={handleDeleteCard}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {addModalState.open && (
        <AddCardModal
          initialTab={addModalState.initialTab}
          editingCard={addModalState.editingCard}
          onClose={() =>
            setAddModalState((prev) => ({ ...prev, open: false, editingCard: null }))
          }
          onSave={handleSaveCard}
          onImportTransferCards={async (transferCards) => {
            const { added } = await mergeIncomingCards(transferCards);
            await refreshCards();
            showToast(
              added > 0
                ? `${added} ${added === 1 ? 'carta trasferita' : 'carte trasferite'} sul telefono!`
                : 'Carte già presenti sul dispositivo'
            );
          }}
        />
      )}

      {klarnaOpen && (
        <KlarnaImportModal
          onClose={() => setKlarnaOpen(false)}
          onImportCards={handleImportKlarnaCards}
        />
      )}

      {backupOpen && (
        <BackupModal
          cards={cards}
          lanUrl={lanUrl}
          canInstallPwa={Boolean(installPrompt)}
          isStandalone={isStandalone}
          onTriggerInstall={handleTriggerInstall}
          onImported={refreshCards}
          onClose={() => setBackupOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
