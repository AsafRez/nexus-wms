import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  QrCode,
  Sparkles,
  X,
} from 'lucide-react';
import {
  PutawayResultDto,
  StagedInventoryItemDto,
  StorageLocationDto,
} from '../../../../shared/wms.contracts';
import { WarehouseViewModel } from '../../models/WarehouseViewModel';
import { warehouseApiService } from '../../services/WarehouseApiService';
import { QrCameraScannerModal } from '../scanner/QrCameraScannerModal';

interface PutawayActionModalProps {
  isOpen: boolean;
  item: StagedInventoryItemDto | null;
  warehouse: WarehouseViewModel;
  locations: StorageLocationDto[];
  onClose: () => void;
  onSuccess: (result: PutawayResultDto) => void;
}

export const PutawayActionModal: React.FC<PutawayActionModalProps> = ({
  isOpen,
  item,
  warehouse,
  locations,
  onClose,
  onSuccess,
}) => {
  const [currentRemaining, setCurrentRemaining] = useState<number>(0);
  const [selectedCellCode, setSelectedCellCode] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (item) {
      setCurrentRemaining(item.stagedQuantity);
      setQuantity(item.stagedQuantity);
      setSelectedCellCode('');
      setErrorMsg(null);
      setSuccessNotice(null);
    }
  }, [item]);

  // Find the selected cell object
  const activeCell = useMemo(() => {
    if (!selectedCellCode.trim()) return null;
    const clean = selectedCellCode.trim().toUpperCase();
    return locations.find((l) => l.code.toUpperCase() === clean) || null;
  }, [locations, selectedCellCode]);

  // Candidate recommended cells:
  // 1. Cells already holding this SKU that have space
  // 2. Empty cells
  const candidateCells = useMemo(() => {
    if (!item) return [];
    const sameSkuCells = locations.filter(
      (l) => l.product && l.product.productId === item.productId && l.currentItems < l.maxUnits,
    );
    const emptyCells = locations.filter((l) => !l.isOccupied || l.currentItems === 0);
    return [...sameSkuCells, ...emptyCells].slice(0, 8);
  }, [locations, item]);

  // Compute cell remaining capacity and warnings
  const cellRemainingCapacity = activeCell
    ? Math.max(0, activeCell.maxUnits - activeCell.currentItems)
    : 0;

  const isCellConflicted = Boolean(
    activeCell &&
      activeCell.isOccupied &&
      activeCell.product &&
      activeCell.product.productId !== item?.productId,
  );

  const isCapacityExceeded = Boolean(
    activeCell && !isCellConflicted && quantity > cellRemainingCapacity,
  );

  const handleCellSelect = (code: string) => {
    setSelectedCellCode(code);
    setErrorMsg(null);

    const cell = locations.find((l) => l.code.toUpperCase() === code.toUpperCase());
    if (cell && !isCellConflicted) {
      const free = cell.maxUnits - cell.currentItems;
      if (quantity > free && free > 0) {
        // Auto-suggest capping to cell capacity
        setQuantity(free);
      }
    }
  };

  const handleConfirmAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !activeCell) {
      setErrorMsg('Please select or scan a valid storage cell.');
      return;
    }

    if (isCellConflicted) {
      setErrorMsg(
        `Cell ${activeCell.code} is occupied by ${activeCell.product?.sku}. Mixing SKUs is not allowed.`,
      );
      return;
    }

    if (quantity <= 0) {
      setErrorMsg('Quantity must be greater than zero.');
      return;
    }

    if (quantity > currentRemaining) {
      setErrorMsg(`Cannot allocate ${quantity} units. Only ${currentRemaining} remain in staging.`);
      return;
    }

    if (quantity > cellRemainingCapacity) {
      setErrorMsg(
        `Cell ${activeCell.code} only has room for ${cellRemainingCapacity} units (max ${activeCell.maxUnits}).`,
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await warehouseApiService.executePutaway(warehouse.id, {
        stagedMovementId: item.id,
        productId: item.productId,
        cellCode: activeCell.code,
        quantity,
      });

      onSuccess(result);

      const leftover = result.remainingStagedQuantity;
      if (leftover > 0) {
        // Multi-cell split flow: stay open and prepare for next cell!
        setCurrentRemaining(leftover);
        setQuantity(leftover);
        setSelectedCellCode('');
        setSuccessNotice(
          `Placed ${quantity} ${item.unitOfMeasure} into cell ${activeCell.code}! ${leftover} ${item.unitOfMeasure} left to put away.`,
        );
      } else {
        // Fully placed!
        setSuccessNotice(`All units successfully placed into storage!`);
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Putaway allocation failed.';
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !item) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal-card"
          style={{ maxWidth: '560px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Boxes className="icon-subtle" size={20} />
                <h2 className="modal-title">Put Away Staged Supplies</h2>
              </div>
              <p className="modal-subtitle">
                Assign received items from staging into physical matrix rack cells.
              </p>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="Close modal">
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleConfirmAllocation} className="modal-body">
            {/* Staged Product Info Banner */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderRadius: '10px',
                background: 'var(--surface-color, #1e293b)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                marginBottom: '16px',
              }}
            >
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{item.productName}</div>
                <div
                  style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-muted, #94a3b8)',
                    marginTop: '2px',
                  }}
                >
                  SKU: <span className="tabular font-mono">{item.sku}</span> · {item.category}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted, #94a3b8)',
                    letterSpacing: '0.05em',
                  }}
                >
                  Remaining in Staging
                </div>
                <div
                  style={{
                    fontSize: '1.5rem',
                    fontWeight: 800,
                    color: 'var(--color-primary, #3b82f6)',
                  }}
                >
                  {currentRemaining}{' '}
                  <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{item.unitOfMeasure}</span>
                </div>
              </div>
            </div>

            {/* Success notification banner in split flow */}
            {successNotice && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  fontSize: '0.875rem',
                  marginBottom: '16px',
                }}
              >
                <CheckCircle2 size={18} />
                <span>{successNotice}</span>
              </div>
            )}

            {/* Cell Selection / QR Scan section */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <label style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  Target Storage Cell (Letter & Number):
                </label>
                <button
                  type="button"
                  className="button button-outline"
                  style={{ padding: '4px 10px', fontSize: '0.8rem', gap: '6px' }}
                  onClick={() => setIsScannerOpen(true)}
                >
                  <QrCode size={15} />
                  Scan Cell QR
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="filter-search"
                  style={{
                    flex: 1,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                    fontSize: '1.05rem',
                  }}
                  placeholder="e.g. A-01, B-03..."
                  value={selectedCellCode}
                  onChange={(e) => handleCellSelect(e.target.value.toUpperCase())}
                />
              </div>

              {/* Quick Recommended Cell Chips */}
              {candidateCells.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted, #94a3b8)',
                      marginBottom: '4px',
                    }}
                  >
                    Recommended Available Cells:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {candidateCells.map((c) => {
                      const isSameSku = c.product?.productId === item.productId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="tag"
                          style={{
                            cursor: 'pointer',
                            background:
                              selectedCellCode === c.code
                                ? 'var(--color-primary, #3b82f6)'
                                : isSameSku
                                  ? 'rgba(16, 185, 129, 0.15)'
                                  : 'rgba(255, 255, 255, 0.05)',
                            color:
                              selectedCellCode === c.code
                                ? '#ffffff'
                                : isSameSku
                                  ? '#34d399'
                                  : 'inherit',
                            borderColor:
                              selectedCellCode === c.code
                                ? 'var(--color-primary, #3b82f6)'
                                : 'rgba(255, 255, 255, 0.1)',
                          }}
                          onClick={() => handleCellSelect(c.code)}
                        >
                          {c.code} ({c.currentItems}/{c.maxUnits})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active Cell State / Capacity Inspector */}
              {activeCell && (
                <div
                  style={{
                    marginTop: '10px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    background: isCellConflicted
                      ? 'rgba(239, 68, 68, 0.1)'
                      : isCapacityExceeded
                        ? 'rgba(245, 158, 11, 0.1)'
                        : 'rgba(59, 130, 246, 0.08)',
                    border: `1px solid ${
                      isCellConflicted
                        ? 'rgba(239, 68, 68, 0.3)'
                        : isCapacityExceeded
                          ? 'rgba(245, 158, 11, 0.3)'
                          : 'rgba(59, 130, 246, 0.2)'
                    }`,
                  }}
                >
                  {isCellConflicted ? (
                    <div style={{ color: '#f87171', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <AlertCircle size={16} />
                      <span>
                        Cell {activeCell.code} is occupied by {activeCell.product?.sku} (
                        {activeCell.product?.productName}). Cannot mix SKUs.
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '4px',
                        }}
                      >
                        <span>
                          Cell <strong>{activeCell.code}</strong> (Row {activeCell.row + 1}, Col{' '}
                          {activeCell.col + 1})
                        </span>
                        <span>
                          Current: {activeCell.currentItems} / Max: {activeCell.maxUnits} units
                        </span>
                      </div>
                      <div style={{ color: isCapacityExceeded ? '#fbbf24' : '#60a5fa' }}>
                        Free Space: <strong>{cellRemainingCapacity} units</strong>
                        {isCapacityExceeded && (
                          <span style={{ marginLeft: '8px' }}>
                            (Allocation will exceed cell limit!)
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quantity to Allocate & Split Options */}
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <label style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  Quantity to Put in this Cell:
                </label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className="tag"
                    style={{ cursor: 'pointer', fontSize: '0.75rem' }}
                    onClick={() => setQuantity(currentRemaining)}
                  >
                    All ({currentRemaining})
                  </button>
                  {currentRemaining > 1 && (
                    <button
                      type="button"
                      className="tag"
                      style={{ cursor: 'pointer', fontSize: '0.75rem' }}
                      onClick={() => setQuantity(Math.floor(currentRemaining / 2))}
                    >
                      Half ({Math.floor(currentRemaining / 2)})
                    </button>
                  )}
                  {cellRemainingCapacity > 0 && cellRemainingCapacity < currentRemaining && (
                    <button
                      type="button"
                      className="tag"
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        color: '#60a5fa',
                        borderColor: '#3b82f6',
                      }}
                      onClick={() => setQuantity(cellRemainingCapacity)}
                    >
                      Fill Cell ({cellRemainingCapacity})
                    </button>
                  )}
                </div>
              </div>

              <input
                type="number"
                className="filter-search"
                min={1}
                max={currentRemaining}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              />

              {quantity < currentRemaining && quantity > 0 && (
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted, #94a3b8)',
                    marginTop: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Sparkles size={14} style={{ color: '#fbbf24' }} />
                  <span>
                    Splitting batch: <strong>{quantity}</strong> will go into {selectedCellCode || 'selected cell'}, leaving{' '}
                    <strong>{currentRemaining - quantity}</strong> in Staging for the next cell.
                  </span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                }}
              >
                <AlertTriangle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="button button-outline"
                onClick={onClose}
                disabled={isSubmitting}
              >
                {currentRemaining < item.stagedQuantity ? 'Finish Later (Keep rest in Staging)' : 'Cancel'}
              </button>

              <button
                type="submit"
                className="button button-primary"
                disabled={
                  isSubmitting ||
                  !activeCell ||
                  isCellConflicted ||
                  quantity <= 0 ||
                  quantity > cellRemainingCapacity ||
                  quantity > currentRemaining
                }
              >
                {isSubmitting ? (
                  'Allocating...'
                ) : (
                  <>
                    Confirm Allocation ({quantity} {item.unitOfMeasure})
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* QR Camera Scanner Modal */}
      <QrCameraScannerModal
        isOpen={isScannerOpen}
        title={`Scan Storage Cell for ${item.sku}`}
        onScan={(code) => handleCellSelect(code)}
        onClose={() => setIsScannerOpen(false)}
      />
    </>
  );
};
