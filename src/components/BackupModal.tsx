import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  HardDrive,
  Maximize2,
  QrCode,
  Share2,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import { exportBackupJson, importBackupJson } from '../services/db';
import { encodeCardsForTransferUrl } from '../services/klarnaPasteParser';
import type { LoyaltyCard } from '../types/card';

interface BackupModalProps {
  cards: LoyaltyCard[];
  lanUrl: string | null;
  canInstallPwa: boolean;
  isStandalone: boolean;
  onTriggerInstall: () => Promise<void>;
  onImported: () => Promise<void>;
  onClose: () => void;
}

export function BackupModal({
  cards,
  lanUrl,
  canInstallPwa,
  isStandalone,
  onTriggerInstall,
  onImported,
  onClose,
}: BackupModalProps) {
  const [includeImages, setIncludeImages] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [transferUrl, setTransferUrl] = useState<string>('');
  const [usedSyncFallback, setUsedSyncFallback] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [qrFullScreen, setQrFullScreen] = useState(false);

  const cardCount = cards.length;
  const currentAppBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname.replace(/\/index\.html$/, '')}`.replace(/\/+$/, '')
      : '';
  const effectiveBaseUrl = lanUrl || currentAppBaseUrl;
  const isLocalhostOnly =
    effectiveBaseUrl.includes('localhost') || effectiveBaseUrl.includes('127.0.0.1');
  const qrUnavailableWithoutSync = usedSyncFallback && !lanUrl;

  useEffect(() => {
    if (cardCount === 0 || !effectiveBaseUrl) {
      setQrImageUrl(null);
      setTransferUrl('');
      return;
    }

    let cancelled = false;
    const { url, usedSyncFallback: usedSync } = encodeCardsForTransferUrl(cards, effectiveBaseUrl);
    setTransferUrl(url);
    setUsedSyncFallback(usedSync);

    if (usedSync && !lanUrl) {
      setQrImageUrl(null);
      return;
    }

    QRCode.toDataURL(url, {
      width: 480,
      margin: 4,
      errorCorrectionLevel: url.length > 500 ? 'L' : 'M',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrImageUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrImageUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cards, cardCount, effectiveBaseUrl, lanUrl]);

  const handleCopyTransferLink = async () => {
    if (!transferUrl) return;
    try {
      await navigator.clipboard.writeText(transferUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignora se clipboard non disponibile
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setStatusMsg(null);
    try {
      const json = await exportBackupJson(includeImages);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `carte-fedelta-backup-${dateStamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg({
        type: 'ok',
        text: `Backup esportato con successo (${cardCount} ${cardCount === 1 ? 'carta' : 'carte'}).`,
      });
    } catch {
      setStatusMsg({ type: 'err', text: 'Errore durante la creazione del file di backup.' });
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setStatusMsg(null);
    try {
      const text = await file.text();
      const { imported, updated } = await importBackupJson(text);
      await onImported();
      setStatusMsg({
        type: 'ok',
        text: `Importazione completata: ${imported} nuove carte aggiunte, ${updated} aggiornate.`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text:
          err instanceof Error
            ? `File non valido: ${err.message}`
            : 'Impossibile leggere il file di backup JSON.',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 safe-top safe-bottom">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur-md">
        <div>
          <h2 className="text-lg font-bold text-white">Passa al Telefono &amp; Backup</h2>
          <p className="text-xs text-slate-400">
            Trasferisci via QR Code o salva un file di backup
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

      <div className="flex-1 overflow-y-auto p-4 space-y-5 max-w-lg w-full mx-auto pb-8">
        {statusMsg && (
          <div
            className={`flex items-start gap-2.5 rounded-2xl border p-3.5 text-sm ${
              statusMsg.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                : 'border-rose-500/40 bg-rose-950/50 text-rose-200'
            }`}
          >
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Sezione Trasferimento Istantaneo PC -> Telefonino via QR */}
        <section className="rounded-3xl border border-indigo-500/35 bg-gradient-to-b from-indigo-950/45 to-slate-900 p-4 space-y-3.5">
          <div className="flex items-center gap-2.5">
            <QrCode className="h-5 w-5 text-indigo-400" />
            <div>
              <h3 className="font-bold text-white text-sm">
                Trasferisci subito sul Telefonino (QR Code)
              </h3>
              <p className="text-xs text-slate-400">
                Inquadra il QR dalla fotocamera del telefonino sulla stessa rete Wi-Fi
              </p>
            </div>
          </div>

          {cardCount === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-400 text-center">
              Aggiungi o incolla almeno una carta sul PC per generare il QR Code di trasferimento al telefonino.
            </div>
          ) : qrUnavailableWithoutSync ? (
            <div className="rounded-2xl border border-amber-500/35 bg-amber-950/40 p-4 text-xs text-amber-200 leading-relaxed">
              Hai molte carte per un singolo QR Code. Usa il pulsante{' '}
              <strong className="text-white">Esporta Backup (.JSON)</strong> qui sotto e invialo al telefonino per importarle tutte in un attimo.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {qrImageUrl && (
                <button
                  type="button"
                  onClick={() => setQrFullScreen(true)}
                  className="group relative rounded-2xl bg-white p-3 shadow-xl active:scale-[0.98] transition-transform"
                  title="Tocca per ingrandire il QR Code"
                >
                  <img
                    src={qrImageUrl}
                    alt="QR Code trasferimento carte su smartphone"
                    className="h-64 w-64 sm:h-72 sm:w-72 object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600">
                    <Maximize2 className="h-3.5 w-3.5" />
                    Tocca per ingrandire a schermo intero
                  </span>
                </button>
              )}

              <p className="text-center text-xs text-slate-300 leading-relaxed">
                {usedSyncFallback
                  ? 'Inquadra questo QR Code dal telefono (stessa rete Wi-Fi): scaricherà automaticamente tutte le carte dal PC!'
                  : 'Inquadra con la fotocamera del telefonino (oppure dentro l’app su Scansiona). Se non mette a fuoco, tocca il QR per ingrandirlo.'}
              </p>

              {isLocalhostOnly && (
                <div className="w-full rounded-2xl border border-amber-500/35 bg-amber-950/40 px-3 py-2.5 text-[11px] text-amber-200">
                  Attenzione: stai usando <code>localhost</code>. Se il telefono non apre il link, usa il file di Backup JSON qui sotto oppure apri dal PC usando il suo indirizzo Wi-Fi (<code>http://192.168.x.x:5173</code>).
                </div>
              )}

              {transferUrl && (
                <div className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                  <span className="flex-1 truncate font-mono text-[11px] text-slate-400">
                    {lanUrl || effectiveBaseUrl}
                  </span>
                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator
                          .share({
                            title: 'Le mie Carte Fedeltà',
                            url: transferUrl,
                          })
                          .catch(() => {});
                      }}
                      className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 text-xs font-semibold text-white active:scale-95 transition-transform"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Invia
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyTransferLink}
                    className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 active:scale-95 transition-transform"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Copiato
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copia link
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Sezione Esporta / Importa */}
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <div className="flex items-center gap-2.5">
            <HardDrive className="h-5 w-5 text-indigo-400" />
            <div>
              <h3 className="font-bold text-white text-sm">Backup locale (.JSON)</h3>
              <p className="text-xs text-slate-400">
                Carte salvate attualmente: <strong className="text-slate-200">{cardCount}</strong>
              </p>
            </div>
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-xs text-slate-300 cursor-pointer">
            <span>Includi foto tessere e screenshot nel backup</span>
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => setIncludeImages(e.target.checked)}
              className="h-5 w-5 rounded accent-indigo-500"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={exporting || cardCount === 0}
              onClick={handleExport}
              className="flex min-h-[50px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 text-sm font-bold text-white active:scale-95 transition-transform disabled:opacity-45"
            >
              <Download className="h-4 w-4" />
              {exporting ? 'Esportazione...' : 'Esporta Backup'}
            </button>

            <label className="flex min-h-[50px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-slate-800 px-4 text-sm font-bold text-slate-100 active:scale-95 transition-transform">
              <Upload className="h-4 w-4" />
              {importing ? 'Importazione...' : 'Importa Backup'}
              <input
                type="file"
                accept="application/json,.json"
                disabled={importing}
                className="hidden"
                onChange={(e) => {
                  handleImportFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="text-[11px] text-slate-500">
            Puoi inviare il file .json a un altro telefono (via WhatsApp, AirDrop, email o Drive) per avere le stesse carte anche lì.
          </p>
        </section>

        {/* Sezione Installazione PWA su iPhone e Android */}
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <Smartphone className="h-5 w-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-white text-sm">Installa come App sul Telefonino</h3>
              <p className="text-xs text-slate-400">
                Funziona anche senza internet al supermercato
              </p>
            </div>
          </div>

          {isStandalone ? (
            <div className="rounded-2xl bg-emerald-950/50 border border-emerald-500/30 px-4 py-3 text-xs text-emerald-200 font-medium">
              App già installata e aperta in modalità schermo intero!
            </div>
          ) : (
            <>
              {canInstallPwa && (
                <button
                  type="button"
                  onClick={onTriggerInstall}
                  className="w-full min-h-[50px] rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-lg active:scale-95 transition-transform"
                >
                  Installa subito nella schermata Home
                </button>
              )}

              <div className="space-y-2.5 text-xs text-slate-300">
                <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3">
                  <p className="font-bold text-white mb-1">Su Android (Chrome / Edge)</p>
                  <p className="text-slate-400">
                    Tocca i tre puntini <strong className="text-slate-200">⋮</strong> in alto a destra e seleziona{' '}
                    <strong className="text-slate-200">“Installa app”</strong> oppure{' '}
                    <strong className="text-slate-200">“Aggiungi a schermata Home”</strong>.
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-950/80 border border-slate-800 p-3">
                  <p className="font-bold text-white mb-1">Su iPhone / iPad (Safari)</p>
                  <p className="text-slate-400">
                    Tocca l’icona <strong className="text-slate-200">Condividi</strong> (quadrato con freccia verso l’alto) in basso e scegli{' '}
                    <strong className="text-slate-200">“Aggiungi alla schermata Home”</strong>.
                  </p>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Modalità QR Code a schermo intero ad altissimo contrasto */}
      {qrFullScreen && qrImageUrl && (
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-white p-4"
          onClick={() => setQrFullScreen(false)}
        >
          <button
            type="button"
            onClick={() => setQrFullScreen(false)}
            className="fixed top-4 right-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"
            aria-label="Chiudi QR ingrandito"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={qrImageUrl}
            alt="QR Code ingrandito"
            className="h-[80vmin] w-[80vmin] max-w-[540px] max-h-[540px] object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
          <p className="mt-3 text-sm font-semibold text-slate-700 text-center">
            Inquadra con la fotocamera del telefonino • Tocca per chiudere
          </p>
        </div>
      )}
    </div>
  );
}
