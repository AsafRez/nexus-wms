import React, { useEffect, useMemo, useState } from 'react';
import { QrCode } from 'lucide-react';
import { StorageLocationDto } from '../../../shared/wms.contracts';
import { CellQrLabelModal } from '../components/locations/CellQrLabelModal';
import { useWarehouse } from '../context/WarehouseContext';
import { warehouseApiService } from '../services/WarehouseApiService';

export const LocationsPage: React.FC = () => {
  const { selectedWarehouse, dataRevision } = useWarehouse();
  const [locations, setLocations] = useState<StorageLocationDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OCCUPIED' | 'AVAILABLE'>('ALL');
  const [query, setQuery] = useState<string>('');
  const [selectedQrCell, setSelectedQrCell] = useState<StorageLocationDto | null>(null);

  useEffect(() => {
    if (!selectedWarehouse) return;
    let cancelled = false;
    setIsLoading(true);

    warehouseApiService
      .fetchLocations(selectedWarehouse.id)
      .then((data) => {
        if (!cancelled) setLocations(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWarehouse?.id, dataRevision]);

  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      if (statusFilter === 'OCCUPIED' && !loc.isOccupied) return false;
      if (statusFilter === 'AVAILABLE' && loc.isOccupied) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        const matchesCell =
          loc.code.toLowerCase().includes(q) || `[${loc.row},${loc.col}]`.includes(q);
        const matchesProduct = Boolean(
          loc.product &&
            (loc.product.productName.toLowerCase().includes(q) ||
              loc.product.sku.toLowerCase().includes(q)),
        );
        return matchesCell || matchesProduct;
      }
      return true;
    });
  }, [locations, statusFilter, query]);

  if (!selectedWarehouse) return null;

  const occupiedCount = locations.filter((l) => l.isOccupied).length;
  const availableCount = locations.length - occupiedCount;

  return (
    <>
      <div className="facility-heading-bar">
        <div>
          <h1>Storage matrix cells</h1>
          <p className="facility-subline">
            {selectedWarehouse.name} · {selectedWarehouse.rows}×{selectedWarehouse.cols} matrix (
            {occupiedCount} occupied, {availableCount} empty)
          </p>
        </div>
        <span className={`tone-tag ${selectedWarehouse.statusBadgeInfo.toneClass} tabular`}>
          {selectedWarehouse.formattedFullLabel}
        </span>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          className="filter-search"
          placeholder="Search cell code (e.g. A-01), item name, or SKU..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="segmented-control" role="group" aria-label="Filter by cell status">
          {(['ALL', 'OCCUPIED', 'AVAILABLE'] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={`segment-btn tabular ${statusFilter === status ? 'active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {status === 'ALL'
                ? `All (${locations.length})`
                : status === 'OCCUPIED'
                  ? `Occupied (${occupiedCount})`
                  : `Empty (${availableCount})`}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="state-notice">Loading 2D matrix cells...</div>
      ) : filtered.length === 0 ? (
        <div className="state-notice">
          No matrix cells match &ldquo;{query}&rdquo;. Clear your search or switch status filter to
          see all cells.
        </div>
      ) : (
        <div className="rack-directory-grid">
          {filtered.map((loc) => (
            <div
              key={loc.id}
              className={`rack-slot-sheet ${loc.isOccupied ? 'occupied' : 'open'}`}
            >
              <div>
                <div className="rack-slot-top">
                  <span className="rack-coord">
                    {loc.code} <span className="subtle-cell">[{loc.row},{loc.col}]</span>
                  </span>
                  <span className={`rack-state-text ${loc.isOccupied ? '' : 'open'}`}>
                    {loc.isOccupied ? 'Occupied' : 'Empty'}
                  </span>
                </div>
                <div className="rack-units tabular" style={{ marginTop: '6px' }}>
                  Items counter: <strong>{loc.currentItems}</strong> / {loc.maxUnits}
                </div>

                {loc.product ? (
                  <div className="rack-cargo">
                    <div className="rack-sku">{loc.product.sku}</div>
                    <div className="rack-product" title={loc.product.productName}>
                      {loc.product.productName}
                    </div>
                  </div>
                ) : loc.isOccupied ? (
                  <div className="rack-open-note">Unassigned bulk cargo</div>
                ) : (
                  <div className="rack-open-note">Open cell — ready for putaway</div>
                )}
              </div>

              <div className="cell-card-controls">
                <button
                  type="button"
                  className="counter-step-btn"
                  title="View and print rack QR label"
                  onClick={() => setSelectedQrCell(loc)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                >
                  <QrCode size={13} />
                  <span>QR Code</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CellQrLabelModal
        isOpen={Boolean(selectedQrCell)}
        warehouse={selectedWarehouse}
        cell={selectedQrCell}
        onClose={() => setSelectedQrCell(null)}
      />
    </>
  );
};
