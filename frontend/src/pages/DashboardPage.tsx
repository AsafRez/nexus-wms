import React, { useEffect, useState } from 'react';
import { StorageLocationDto, WarehouseDashboardDto } from '../../../shared/wms.contracts';
import { useWarehouse } from '../context/WarehouseContext';
import { WarehouseViewModel } from '../models/WarehouseViewModel';
import { warehouseApiService } from '../services/WarehouseApiService';

export const DashboardPage: React.FC = () => {
  const { selectedWarehouse, refreshWarehouses, dataRevision } = useWarehouse();
  const [dashboard, setDashboard] = useState<WarehouseDashboardDto | null>(null);
  const [selectedCell, setSelectedCell] = useState<StorageLocationDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAdjusting, setIsAdjusting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedWarehouse) return;

    let cancelled = false;
    setIsLoading(true);
    setActionError(null);

    warehouseApiService
      .fetchDashboard(selectedWarehouse.id)
      .then((dashData) => {
        if (!cancelled) {
          setDashboard(dashData);
          setSelectedCell((prev) => {
            if (prev && dashData.matrix?.[prev.row]?.[prev.col]) {
              return dashData.matrix[prev.row][prev.col];
            }
            return dashData.matrix?.[0]?.[0] ?? null;
          });
        }
      })
      .catch((err) => console.error('Failed to load warehouse overview:', err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWarehouse?.id, dataRevision]);

  const handleAdjustItems = async (delta: number) => {
    if (!dashboard || !selectedCell || isAdjusting) return;
    setIsAdjusting(true);
    setActionError(null);

    try {
      const result = await warehouseApiService.adjustMatrixCell(
        dashboard.warehouse.id,
        selectedCell.row,
        selectedCell.col,
        delta,
      );

      // Update local 2D matrix & row breakdown immediately
      const nextMatrix = dashboard.matrix.map((rowCells, rIdx) =>
        rowCells.map((c, cIdx) =>
          rIdx === result.cell.row && cIdx === result.cell.col ? result.cell : c,
        ),
      );

      const nextRowBreakdown = nextMatrix.map((rowCells, rowIdx) => {
        const totalPlaces = rowCells.length;
        const usedPlaces = rowCells.filter((c) => c.isOccupied).length;
        const totalItemsInRow = rowCells.reduce((sum, c) => sum + c.currentItems, 0);
        return {
          rowLabel: `Row ${String.fromCharCode(65 + rowIdx)}`,
          rowIndex: rowIdx,
          totalPlaces,
          usedPlaces,
          totalItemsInRow,
          occupancyPercentage:
            totalPlaces === 0 ? 0 : Math.round((usedPlaces / totalPlaces) * 1000) / 10,
        };
      });

      setDashboard({
        ...dashboard,
        warehouse: result.warehouse,
        matrix: nextMatrix,
        rowBreakdown: nextRowBreakdown,
      });
      setSelectedCell(result.cell);
      refreshWarehouses();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setIsAdjusting(false);
    }
  };

  if (!selectedWarehouse || (isLoading && !dashboard)) {
    return <div className="state-notice">Loading warehouse 2D matrix and capacity data...</div>;
  }

  if (!dashboard) {
    return <div className="state-notice">Choose a warehouse from the top selector to begin.</div>;
  }

  const whModel = new WarehouseViewModel(dashboard.warehouse);
  const badge = whModel.statusBadgeInfo;
  const fillScale = Math.min(1, Math.max(0, whModel.occupancyPercentage / 100));
  const meterTone =
    whModel.occupancyPercentage >= 90
      ? 'critical'
      : whModel.occupancyPercentage >= 75
        ? 'high'
        : '';

  return (
    <>
      <div className="facility-heading-bar">
        <div>
          <h1>{whModel.name}</h1>
          <p className="facility-subline">
            {whModel.typeDisplayName} in {whModel.city} ({whModel.code}) ·{' '}
            {whModel.matrixDimensionsText}
          </p>
        </div>
        <span className={`tone-tag ${badge.toneClass}`}>{badge.label}</span>
      </div>

      {/* Hero Architectural Floorplate: Capacity Readout + Interactive 2D Matrix */}
      <section className="capacity-floorplate corner-frame" aria-label="Warehouse capacity">
        <span className="corner top-left" />
        <span className="corner top-right" />
        <span className="corner bottom-left" />
        <span className="corner bottom-right" />

        <div className="capacity-readout-pane">
          <div>
            <div className="readout-label">Used storage capacity</div>
            <div className="capacity-big-row">
              <span className="capacity-big-number">{whModel.occupancyPercentage}%</span>
              <span className="capacity-big-unit">full</span>
            </div>

            <div className="capacity-meter-bar" aria-hidden="true">
              <div
                className={`capacity-meter-fill ${meterTone}`}
                style={{ transform: `scaleX(${fillScale})` }}
              />
            </div>

            <p className="capacity-plain-explanation">
              {whModel.usedCapacity} of {whModel.totalCapacity} matrix cells ({whModel.rows}×
              {whModel.cols}) hold items right now, totaling{' '}
              <strong className="tabular">{whModel.totalItemsCounter.toLocaleString()}</strong>{' '}
              stored items.
            </p>
          </div>

          <div className="place-counts-split">
            <div className="place-count-item">
              <span className="place-count-num">{whModel.usedCapacity}/{whModel.totalCapacity}</span>
              <span className="place-count-label">Occupied cells</span>
            </div>
            <div className="place-count-item">
              <span className="place-count-num">{whModel.availableCapacity}</span>
              <span className="place-count-label">Empty cells</span>
            </div>
            <div className="place-count-item">
              <span className="place-count-num">{whModel.totalItemsCounter.toLocaleString()}</span>
              <span className="place-count-label">Items counter</span>
            </div>
          </div>
        </div>

        {/* Right Pane: True 2D Warehouse Matrix [row][col] */}
        <div className="floorplan-pane">
          <div className="floorplan-header">
            <span className="floorplan-title">
              2D storage matrix ({whModel.rows} rows × {whModel.cols} columns)
            </span>
            <div className="floorplan-legend">
              <span className="legend-key">
                <span className="swatch occupied" /> Occupied ({whModel.usedCapacity})
              </span>
              <span className="legend-key">
                <span className="swatch open" /> Empty ({whModel.availableCapacity})
              </span>
            </div>
          </div>

          <div className="matrix-scroll-wrap">
            <div
              className="warehouse-2d-matrix"
              style={{
                gridTemplateColumns: `32px repeat(${whModel.cols}, minmax(30px, 1fr))`,
              }}
            >
              {/* Top Column Index Row */}
              <span className="matrix-axis-corner" />
              {Array.from({ length: whModel.cols }).map((_, cIdx) => (
                <span key={cIdx} className="matrix-col-header">
                  {String(cIdx + 1).padStart(2, '0')}
                </span>
              ))}

              {/* Matrix Rows [row][col] */}
              {dashboard.matrix.map((rowCells, rIdx) => (
                <React.Fragment key={rIdx}>
                  <span className="matrix-row-header">{String.fromCharCode(65 + rIdx)}</span>
                  {rowCells.map((cell) => {
                    const isSelected =
                      selectedCell?.row === cell.row && selectedCell?.col === cell.col;
                    return (
                      <button
                        key={cell.id}
                        type="button"
                        className={`matrix-cell-btn ${cell.isOccupied ? 'occupied' : 'empty'} ${
                          isSelected ? 'selected' : ''
                        }`}
                        onClick={() => {
                          setSelectedCell(cell);
                          setActionError(null);
                        }}
                        title={`[${cell.row}, ${cell.col}] ${cell.code}: ${cell.currentItems}/${cell.maxUnits} items`}
                      >
                        {cell.currentItems}
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Interactive Cell Counter Bar */}
          <div className="bay-inspector-strip">
            {selectedCell ? (
              <>
                <div className="inspector-left-group">
                  <span className="inspector-slot">
                    Cell [{selectedCell.row}, {selectedCell.col}] ({selectedCell.code})
                  </span>
                  <span className="inspector-detail tabular">
                    Counter: <strong>{selectedCell.currentItems}</strong> / {selectedCell.maxUnits}{' '}
                    items (
                    {selectedCell.product
                      ? `${selectedCell.product.sku} · ${selectedCell.product.productName}`
                      : selectedCell.isOccupied
                        ? 'occupied'
                        : 'empty'}
                    )
                  </span>
                </div>
                <div className="counter-actions">
                  <button
                    type="button"
                    className="counter-step-btn"
                    disabled={isAdjusting || selectedCell.currentItems < 5}
                    onClick={() => handleAdjustItems(-5)}
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    className="counter-step-btn"
                    disabled={isAdjusting || selectedCell.currentItems === 0}
                    onClick={() => handleAdjustItems(-1)}
                  >
                    -1 item
                  </button>
                  <button
                    type="button"
                    className="counter-step-btn add"
                    disabled={
                      isAdjusting ||
                      !selectedCell.product ||
                      selectedCell.currentItems >= selectedCell.maxUnits
                    }
                    title={
                      !selectedCell.product
                        ? 'Empty cell — assign a SKU via Inventory -> Manage Stock first'
                        : undefined
                    }
                    onClick={() => handleAdjustItems(+1)}
                  >
                    +1 item
                  </button>
                  <button
                    type="button"
                    className="counter-step-btn add"
                    disabled={
                      isAdjusting ||
                      !selectedCell.product ||
                      selectedCell.currentItems + 5 > selectedCell.maxUnits
                    }
                    title={
                      !selectedCell.product
                        ? 'Empty cell — assign a SKU via Inventory -> Manage Stock first'
                        : undefined
                    }
                    onClick={() => handleAdjustItems(+5)}
                  >
                    +5
                  </button>
                </div>
              </>
            ) : (
              <span className="inspector-detail">
                Select any [row, col] matrix cell to adjust its item counter
              </span>
            )}
          </div>

          {actionError && <div className="inline-error">{actionError}</div>}
        </div>
      </section>

      {/* Architectural Ledger Strip */}
      <section className="ledger-strip" aria-label="Stock and dock figures">
        <div className="ledger-cell">
          <span className="ledger-stat-label">Matrix item counter</span>
          <span className="ledger-stat-value">{whModel.totalItemsCounter.toLocaleString()}</span>
          <span className="ledger-stat-note">
            Items across {whModel.rows}×{whModel.cols} storage cells
          </span>
        </div>

        <div className="ledger-cell">
          <span className="ledger-stat-label">Catalog SKUs in site</span>
          <span className="ledger-stat-value">{dashboard.metrics.totalSkusStored}</span>
          <span className="ledger-stat-note">
            {dashboard.metrics.totalUnitsInStock.toLocaleString()} catalog units recorded
          </span>
        </div>

        <div className="ledger-cell">
          <span className="ledger-stat-label">Inbound dock queue</span>
          <span className="ledger-stat-value">{dashboard.metrics.pendingInboundCount}</span>
          <span className="ledger-stat-note">Open receiving shipments</span>
        </div>

        <div className="ledger-cell">
          <span className="ledger-stat-label">Outbound pick queue</span>
          <span className="ledger-stat-value">{dashboard.metrics.pendingOutboundCount}</span>
          <span className="ledger-stat-note">Orders awaiting dispatch</span>
        </div>
      </section>

      {/* Matrix Row Breakdown & Dock Manifest Log */}
      <div className="operations-split">
        <section className="ledger-panel">
          <div className="panel-head">
            <h2>Matrix row utilization</h2>
            <span className="panel-count">{dashboard.rowBreakdown.length} rows</span>
          </div>
          <div className="zone-rows">
            {dashboard.rowBreakdown.map((r) => (
              <div key={r.rowIndex}>
                <div className="zone-row-top">
                  <span className="zone-row-title">{r.rowLabel}</span>
                  <span className="zone-ratio">
                    {r.usedPlaces}/{r.totalPlaces} cells · {r.totalItemsInRow} items (
                    {r.occupancyPercentage}%)
                  </span>
                </div>
                <div className="zone-bar-track">
                  <div
                    className={`zone-bar-fill ${r.occupancyPercentage >= 80 ? 'high' : ''}`}
                    style={{
                      transform: `scaleX(${Math.min(1, Math.max(0, r.occupancyPercentage / 100))})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ledger-panel">
          <div className="panel-head">
            <h2>Recent dock log</h2>
            <span className="panel-count">{dashboard.recentMovements.length} entries</span>
          </div>
          <div className="manifest-list">
            {dashboard.recentMovements.map((mov) => (
              <div key={mov.id} className="manifest-row">
                <span className={`direction-tag ${mov.type === 'INBOUND' ? 'in' : 'out'}`}>
                  {mov.type === 'INBOUND' ? 'Inbound' : 'Outbound'}
                </span>
                <div>
                  <div className="manifest-primary">
                    <span className="mono">{mov.referenceCode}</span> · {mov.productName}
                  </div>
                  <div className="manifest-secondary">
                    {mov.partnerName}
                    {mov.locationCode ? (
                      <>
                        , cell <span className="mono">{mov.locationCode}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="manifest-right">
                  <div className="manifest-qty">
                    {mov.type === 'INBOUND' ? '+' : '-'}
                    {mov.quantity}
                  </div>
                  <div className="manifest-state">{mov.status.toLowerCase().replace('_', ' ')}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
};
