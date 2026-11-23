import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownAZ,
  Barcode,
  Camera,
  CreditCard,
  FolderUp,
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
  saveCard,
  saveMultipleCards,
  syncFromServerOrHash,
  toggleCardFavorite,
} from './services/db';
import { CATEGORY_OPTIONS, type CardCategory, type LoyaltyCard } from './types/card';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type SortMode = 'smart' | 'alpha' | 'recent';

export function App() {
  const [cards, setCards] = useState<LoyaltyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | CardCategory>('all');
  const [sortMode, setSortMode] = useState<SortMode>('smart');
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
    setSortMode((prev) => (prev === 'smart' ? 'alpha' : prev === 'alpha' ? 'recent' : 'smart'));
  };

  const sortLabel =
    sortMode === 'smart' ? 'Più usate' : sortMode === 'alpha' ? 'A–Z' : 'Recenti';

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-950 text-slate-100 safe-top pb-[calc(5.75rem+env(safe-area-inset-bottom))]">
      {/* Sticky Glass Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-md shadow-indigo-950/60">
              <Barcode className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight text-white">
                Carte Fedeltà
              </h1>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span>
                  {cards.length} {cards.length === 1 ? 'carta salvata' : 'carte salvate'}
                </span>
                {isOffline && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                    <WifiOff className="h-3 w-3" />
                    Offline
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {cards.length > 0 && (
              <button
                type="button"
                onClick={() => setBackupOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-indigo-600/20 border border-indigo-500/35 px-2.5 sm:px-3 text-xs font-semibold text-indigo-200 active:scale-95 transition-transform"
                title="Passa le carte al telefonino via QR"
              >
                <QrCode className="h-4 w-4 text-indigo-400" />
                <span className="hidden xs:inline sm:inline">Passa al Telefono</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setKlarnaOpen(true)}
              className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-pink-600/20 border border-pink-500/35 px-3 text-xs font-semibold text-pink-200 active:scale-95 transition-transform"
            >
              <FolderUp className="h-4 w-4 text-pink-400" />
              Da Klarna
            </button>
            <button
              type="button"
              onClick={() =>
                setAddModalState({ open: true, initialTab: 'manual', editingCard: null })
              }
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md active:scale-95 transition-transform"
              aria-label="Aggiungi carta"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Barra di ricerca e filtri */}
        {cards.length > 0 && (
          <div className="mx-auto mt-3 max-w-2xl space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cerca negozio o codice..."
                  className="w-full min-h-[46px] rounded-2xl border border-slate-800 bg-slate-900/90 pl-10 pr-9 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-slate-400"
                    aria-label="Pulisci ricerca"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={cycleSortMode}
                className="flex min-h-[46px] shrink-0 items-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-900 px-3 text-xs font-semibold text-slate-300 active:scale-95 transition-transform"
                title="Cambia ordinamento"
              >
                <ArrowDownAZ className="h-4 w-4 text-indigo-400" />
                <span>{sortLabel}</span>
              </button>
            </div>

            {/* Horizontal Snap Categories */}
            <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`snap-start shrink-0 min-h-[38px] rounded-full px-3.5 text-xs font-semibold transition-colors ${
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
                    className={`snap-start shrink-0 min-h-[38px] rounded-full px-3.5 text-xs font-semibold transition-colors ${
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
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="h-36 animate-pulse rounded-3xl bg-slate-900 border border-slate-800"
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

              <div className="mt-6 grid grid-cols-1 gap-3 text-left">
                <button
                  type="button"
                  onClick={() =>
                    setAddModalState({ open: true, initialTab: 'photo', editingCard: null })
                  }
                  className="flex min-h-[72px] items-center gap-4 rounded-2xl bg-indigo-600 p-4 text-white shadow-lg shadow-indigo-950/60 active:scale-[0.98] transition-transform"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                    <Camera className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="font-bold text-base">Fotografa o Scansiona una tessera</p>
                    <p className="text-xs text-indigo-100/85">
                      Legge il codice a barre dalla fotocamera o da una foto fronte/retro
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setKlarnaOpen(true)}
                  className="flex min-h-[72px] items-center gap-4 rounded-2xl border border-pink-500/35 bg-pink-950/35 p-4 text-white active:scale-[0.98] transition-transform"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pink-500/25">
                    <Sparkles className="h-6 w-6 text-pink-300" />
                  </div>
                  <div>
                    <p className="font-bold text-base">Trasferisci le carte da Klarna</p>
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
            <p className="text-sm text-slate-400">Nessuna carta trovata per la ricerca corrente.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              className="min-h-[44px] rounded-xl bg-slate-800 px-4 text-xs font-semibold text-white"
            >
              Mostra tutte le carte
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {displayedCards.map((card) => (
              <div
                key={card.id}
                onClick={() => handleOpenCard(card)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenCard(card);
                  }
                }}
                className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-lg cursor-pointer active:scale-[0.97] transition-transform min-h-[146px]"
              >
                {/* Testata colorata del brand */}
                <div
                  className="relative px-3.5 pt-3.5 pb-4"
                  style={{
                    background: `linear-gradient(135deg, ${card.color} 0%, ${card.color}cc 100%)`,
                  }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="line-clamp-2 text-base font-bold leading-tight text-white drop-shadow-sm">
                      {card.storeName}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(card.id);
                      }}
                      className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/20 text-white"
                      aria-label={card.isFavorite ? 'Togli preferito' : 'Metti tra preferiti'}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          card.isFavorite ? 'fill-amber-300 text-amber-300' : 'text-white/75'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Parte inferiore con mini badge barcode e numero */}
                <div className="flex flex-1 flex-col justify-between bg-slate-900 px-3.5 py-2.5">
                  <p className="truncate font-mono text-xs text-slate-300">
                    {formatCodeGroups(card.cardNumber)}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-400">
                      <Barcode className="h-3.5 w-3.5 text-indigo-400" />
                      {card.barcodeFormat}
                    </span>
                    {card.source === 'klarna' ? (
                      <span className="rounded-md bg-pink-500/15 px-1.5 py-0.5 text-pink-300 font-medium">
                        Klarna
                      </span>
                    ) : card.frontImage || card.backImage ? (
                      <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-300">
                        Foto
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar Ergonomica (Thumb Zone) */}
      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800/80 bg-slate-950/92 backdrop-blur-lg safe-bottom">
        <div className="mx-auto flex h-[68px] max-w-2xl items-center justify-around px-2">
          <button
            type="button"
            onClick={() =>
              setAddModalState({ open: true, initialTab: 'camera', editingCard: null })
            }
            className="flex flex-1 min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-slate-300 hover:text-white active:scale-95 transition-transform"
          >
            <Camera className="h-5 w-5 text-indigo-400" />
            <span className="text-[11px] font-semibold">Scansiona</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setAddModalState({ open: true, initialTab: 'photo', editingCard: null })
            }
            className="flex flex-1 min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-slate-300 hover:text-white active:scale-95 transition-transform"
          >
            <ImagePlus className="h-5 w-5 text-emerald-400" />
            <span className="text-[11px] font-semibold">Fotografa</span>
          </button>

          <button
            type="button"
            onClick={() => setKlarnaOpen(true)}
            className="flex flex-1 min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-slate-300 hover:text-white active:scale-95 transition-transform"
          >
            <FolderUp className="h-5 w-5 text-pink-400" />
            <span className="text-[11px] font-semibold">Da Klarna</span>
          </button>

          <button
            type="button"
            onClick={() => setBackupOpen(true)}
            className="flex flex-1 min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-slate-300 hover:text-white active:scale-95 transition-transform"
          >
            <HardDrive className="h-5 w-5 text-amber-400" />
            <span className="text-[11px] font-semibold">Backup / App</span>
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
