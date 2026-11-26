import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCw, X, Zap } from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';

interface QrCameraScannerModalProps {
  isOpen: boolean;
  title?: string;
  onScan: (code: string) => void;
  onClose: () => void;
}

export const QrCameraScannerModal: React.FC<QrCameraScannerModalProps> = ({
  isOpen,
  title = 'Scan Storage Cell QR Code',
  onScan,
  onClose,
}) => {
  const [manualCode, setManualCode] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [scannedResult, setScannedResult] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = 'interactive-qr-reader-container';

  // Sound feedback on scan
  const playBeep = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch {
      // AudioContext disallowed or unavailable
    }
  };

  const handleSuccessfulScan = (rawText: string) => {
    const trimmed = rawText.trim().toUpperCase();
    if (!trimmed) return;

    // Extract cell code pattern if enclosed in json or url (e.g., "A-01")
    let cellCode = trimmed;
    const match = trimmed.match(/[A-Z]-\d{2}/);
    if (match) {
      cellCode = match[0];
    }

    playBeep();
    setScannedResult(cellCode);

    // Stop camera before closing
    if (scannerRef.current && scannerRef.current.isScanning) {
      scannerRef.current.stop().catch(() => {});
    }

    setTimeout(() => {
      onScan(cellCode);
      onClose();
    }, 400);
  };

  useEffect(() => {
    if (!isOpen) {
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(() => {});
        }
        scannerRef.current = null;
      }
      setIsCameraActive(false);
      setScannedResult(null);
      setErrorMsg(null);
      setManualCode('');
      return;
    }

    let isMounted = true;

    // Small delay to ensure modal DOM is mounted
    const timer = setTimeout(() => {
      if (!isMounted) return;
      try {
        const scanner = new Html5Qrcode(containerId);
        scannerRef.current = scanner;

        const config = {
          fps: 15,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.0,
        };

        scanner
          .start(
            { facingMode: 'environment' },
            config,
            (decodedText) => {
              if (isMounted) {
                handleSuccessfulScan(decodedText);
              }
            },
            () => {
              // Ignore frame decode misses
            },
          )
          .then(() => {
            if (isMounted) setIsCameraActive(true);
          })
          .catch((err) => {
            if (isMounted) {
              console.warn('Camera start error:', err);
              setErrorMsg(
                'Camera could not be accessed. You can still type the cell code manually below.',
              );
              setIsCameraActive(false);
            }
          });
      } catch (err) {
        if (isMounted) {
          setErrorMsg('Failed to initialize camera scanner.');
          console.error(err);
        }
      }
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current.stop().catch(() => {});
        }
        scannerRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: '440px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Camera className="icon-subtle" size={20} />
            <h2 className="modal-title">{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close scanner">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ textAlign: 'center' }}>
          {scannedResult ? (
            <div style={{ padding: '32px 16px' }}>
              <CheckCircle2
                size={54}
                style={{ color: 'var(--color-success, #10b981)', marginBottom: '12px' }}
              />
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>Cell Scanned!</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '8px', letterSpacing: '0.05em' }}>
                {scannedResult}
              </div>
            </div>
          ) : (
            <>
              <div
                id={containerId}
                style={{
                  width: '100%',
                  minHeight: '260px',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: '#090d16',
                  position: 'relative',
                  marginBottom: '16px',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                }}
              />

              {!isCameraActive && !errorMsg && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted, #94a3b8)', marginBottom: '12px' }}>
                  <RefreshCw className="spin" size={16} />
                  <span>Requesting camera feed...</span>
                </div>
              )}

              {errorMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: '0.85rem',
                    marginBottom: '14px',
                    textAlign: 'left',
                  }}
                >
                  {errorMsg}
                </div>
              )}

              <div style={{ textAlign: 'left', marginTop: '12px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Manual Cell Code Entry:
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="filter-search"
                    style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    placeholder="e.g. A-01, B-04"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && manualCode.trim()) {
                        handleSuccessfulScan(manualCode);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!manualCode.trim()}
                    onClick={() => handleSuccessfulScan(manualCode)}
                  >
                    <Zap size={16} />
                    Apply
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
