import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { BarcodeFormatType } from '../types/card';

interface BarcodeDisplayProps {
  code: string;
  format: BarcodeFormatType;
  height?: number;
  displayValue?: boolean;
  compact?: boolean;
  className?: string;
}

export function formatCodeGroups(code: string): string {
  const cleaned = code.trim();
  if (/^\d{8,24}$/.test(cleaned)) {
    return cleaned.replace(/(.{4})/g, '$1 ').trim();
  }
  return cleaned;
}

export function renderBarcodeToSvg(
  svgElement: SVGSVGElement,
  code: string,
  preferredFormat: BarcodeFormatType,
  options?: { height?: number; displayValue?: boolean; barWidth?: number; margin?: number }
): { renderedFormat: BarcodeFormatType; fallbackUsed: boolean; error?: string } {
  const trimmed = code.trim();
  if (!trimmed) {
    return { renderedFormat: preferredFormat, fallbackUsed: false, error: 'Codice vuoto' };
  }

  const baseOptions = {
    lineColor: '#000000',
    background: '#ffffff',
    width: options?.barWidth ?? 2.2,
    height: options?.height ?? 100,
    displayValue: options?.displayValue ?? false,
    margin: options?.margin ?? 12,
    fontSize: 16,
  };

  const tryFormat = (fmt: BarcodeFormatType): boolean => {
    let validResult = true;
    try {
      svgElement.innerHTML = '';
      JsBarcode(svgElement, trimmed, {
        ...baseOptions,
        format: fmt,
        valid: (valid) => {
          validResult = valid;
        },
      });
      return validResult && svgElement.childNodes.length > 0;
    } catch {
      return false;
    }
  };

  if (preferredFormat !== 'QR' && tryFormat(preferredFormat)) {
    return { renderedFormat: preferredFormat, fallbackUsed: false };
  }

  // Fallback automatico a CODE128 per garantire sempre un codice leggibile alla cassa
  if (preferredFormat !== 'CODE128' && tryFormat('CODE128')) {
    return { renderedFormat: 'CODE128', fallbackUsed: true };
  }

  return {
    renderedFormat: preferredFormat,
    fallbackUsed: false,
    error: 'Caratteri non supportati dal codice a barre',
  };
}

export function BarcodeDisplay({
  code,
  format,
  height = 110,
  displayValue = false,
  compact = false,
  className = '',
}: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const trimmedCode = code.trim();

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    setFallbackUsed(false);

    if (!trimmedCode) {
      setQrDataUrl(null);
      setRenderError('Nessun codice inserito');
      return;
    }

    if (format === 'QR') {
      QRCode.toDataURL(trimmedCode, {
        width: compact ? 180 : 320,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then((url) => {
          if (!cancelled) {
            setQrDataUrl(url);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setQrDataUrl(null);
            setRenderError('Impossibile generare il QR Code');
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setQrDataUrl(null);
    const svg = svgRef.current;
    if (!svg) return;

    const result = renderBarcodeToSvg(svg, trimmedCode, format, {
      height,
      displayValue,
      barWidth: compact ? 1.8 : 2.4,
      margin: compact ? 8 : 14,
    });

    setFallbackUsed(result.fallbackUsed);
    setRenderError(result.error ?? null);

    return () => {
      cancelled = true;
    };
  }, [trimmedCode, format, height, displayValue, compact]);

  if (renderError) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-2xl bg-white p-4 text-center text-slate-800 ${className}`}>
        <span className="font-mono text-lg font-bold tracking-wider break-all">{trimmedCode || '—'}</span>
        <span className="mt-1 text-xs text-rose-600">{renderError}</span>
      </div>
    );
  }

  if (format === 'QR') {
    return (
      <div className={`flex flex-col items-center justify-center rounded-2xl bg-white p-3 ${className}`}>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`QR Code ${trimmedCode}`}
            className={compact ? 'h-28 w-28 object-contain' : 'h-52 w-52 object-contain'}
          />
        ) : (
          <div className={compact ? 'h-28 w-28 animate-pulse rounded-xl bg-slate-100' : 'h-52 w-52 animate-pulse rounded-xl bg-slate-100'} />
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center rounded-2xl bg-white px-3 py-2 ${className}`}>
      <svg
        ref={svgRef}
        className="max-w-full h-auto"
        role="img"
        aria-label={`Codice a barre ${trimmedCode}`}
      />
      {!compact && fallbackUsed && (
        <span className="mt-1 text-[11px] font-medium text-slate-500">
          Adattato automaticamente a CODE 128 per compatibilità
        </span>
      )}
    </div>
  );
}
