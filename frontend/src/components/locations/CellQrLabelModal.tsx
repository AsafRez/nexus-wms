import React, { useEffect, useState } from 'react';
import { Printer, QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import { StorageLocationDto } from '../../../../shared/wms.contracts';
import { WarehouseViewModel } from '../../models/WarehouseViewModel';

interface CellQrLabelModalProps {
  isOpen: boolean;
  warehouse: WarehouseViewModel;
  cell: StorageLocationDto | null;
  onClose: () => void;
}

export const CellQrLabelModal: React.FC<CellQrLabelModalProps> = ({
  isOpen,
  warehouse,
  cell,
  onClose,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (cell) {
      QRCode.toDataURL(cell.code, {
        width: 320,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('Failed to generate QR:', err));
    } else {
      setQrDataUrl('');
    }
  }, [cell]);

  if (!isOpen || !cell) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: '440px', textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <QrCode className="icon-subtle" size={20} />
            <h2 className="modal-title">Cell Shelf QR Label</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Printable Label Card */}
          <div
            id="printable-shelf-label"
            style={{
              background: '#ffffff',
              color: '#000000',
              padding: '24px 20px',
              borderRadius: '12px',
              border: '2px solid #000000',
              maxWidth: '300px',
              margin: '0 auto 16px auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#666666',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '4px',
                marginBottom: '8px',
              }}
            >
              NexusWMS · {warehouse.code}
            </div>

            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt={`QR for cell ${cell.code}`}
                style={{
                  width: '180px',
                  height: '180px',
                  display: 'block',
                  margin: '0 auto',
                }}
              />
            )}

            <div
              style={{
                fontSize: '2.4rem',
                fontWeight: 900,
                letterSpacing: '0.05em',
                lineHeight: 1.1,
                marginTop: '8px',
              }}
            >
              {cell.code}
            </div>

            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#475569',
                marginTop: '4px',
              }}
            >
              Row {String.fromCharCode(65 + cell.row)} · Column {cell.col + 1}
            </div>

            {cell.product && (
              <div
                style={{
                  fontSize: '0.75rem',
                  color: '#64748b',
                  marginTop: '6px',
                  borderTop: '1px dashed #cbd5e1',
                  paddingTop: '6px',
                }}
              >
                Assigned: {cell.product.sku} ({cell.currentItems}/{cell.maxUnits})
              </div>
            )}
          </div>

          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted, #94a3b8)',
              marginBottom: '20px',
            }}
          >
            Affix this QR sticker to the physical rack. When receiving stock, staff can scan this
            code with any camera to instantly put away items.
          </p>

          <div className="modal-actions" style={{ justifyContent: 'center', gap: '12px' }}>
            <button type="button" className="button button-outline" onClick={onClose}>
              Close
            </button>
            <button type="button" className="button button-primary" onClick={handlePrint}>
              <Printer size={16} />
              Print Label
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
