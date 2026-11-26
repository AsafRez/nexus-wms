import React, { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Clock,
  Minus,
  PackageCheck,
  Plus,
  Truck,
} from 'lucide-react';
import {
  AdjustInventoryResultDto,
  InventoryActionType,
  PutawayResultDto,
  StagedInventoryItemDto,
  StorageLocationDto,
  WarehouseInventoryItemDto,
} from '../../../shared/wms.contracts';
import { InventoryActionModal } from '../components/inventory/InventoryActionModal';
import { PutawayActionModal } from '../components/inventory/PutawayActionModal';
import { useWarehouse } from '../context/WarehouseContext';
import { warehouseApiService } from '../services/WarehouseApiService';

export const InventoryPage: React.FC = () => {
  const { selectedWarehouse, refreshWarehouses, dataRevision } = useWarehouse();
  const [activeTab, setActiveTab] = useState<'IN_RACK' | 'STAGING'>('IN_RACK');
  const [items, setItems] = useState<WarehouseInventoryItemDto[]>([]);
  const [stagedItems, setStagedItems] = useState<StagedInventoryItemDto[]>([]);
  const [locations, setLocations] = useState<StorageLocationDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  // InventoryActionModal state (Receive/Remove)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalAction, setModalAction] = useState<InventoryActionType>('INSERT');
  const [modalProductId, setModalProductId] = useState<string | undefined>(undefined);
  const [lastOperationBanner, setLastOperationBanner] = useState<string | null>(null);

  // PutawayActionModal state
  const [isPutawayModalOpen, setIsPutawayModalOpen] = useState<boolean>(false);
  const [selectedPutawayItem, setSelectedPutawayItem] = useState<StagedInventoryItemDto | null>(
    null,
  );

  const loadData = async (warehouseId: string) => {
    setIsLoading(true);
    try {
      const [invData, stagedData, locsData] = await Promise.all([
        warehouseApiService.fetchInventory(warehouseId),
        warehouseApiService.fetchStagedInventory(warehouseId),
        warehouseApiService.fetchLocations(warehouseId),
      ]);
      setItems(invData);
      setStagedItems(stagedData);
      setLocations(locsData);
    } catch (err) {
      console.error('Failed to load inventory data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedWarehouse) return;
    loadData(selectedWarehouse.id);
  }, [selectedWarehouse?.id, dataRevision]);

  const filteredInRack = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) ||
        i.productName.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [items, query]);

  const filteredStaged = useMemo(() => {
    if (!query.trim()) return stagedItems;
    const q = query.toLowerCase();
    return stagedItems.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) ||
        i.productName.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.partnerName.toLowerCase().includes(q) ||
        i.referenceCode.toLowerCase().includes(q),
    );
  }, [stagedItems, query]);

  const openModal = (action: InventoryActionType, productId?: string) => {
    setModalAction(action);
    setModalProductId(productId);
    setIsModalOpen(true);
  };

  const openPutaway = (stagedItem: StagedInventoryItemDto) => {
    setSelectedPutawayItem(stagedItem);
    setIsPutawayModalOpen(true);
  };

  const handleModalSuccess = async (result: AdjustInventoryResultDto) => {
    setIsModalOpen(false);
    if (!selectedWarehouse) return;

    await loadData(selectedWarehouse.id);

    const verb =
      result.movement.type === 'INBOUND_RECEIVE'
        ? 'Received into Staging'
        : result.movement.type === 'INBOUND'
          ? 'Placed into Rack'
          : 'Removed';

    const cellNote = result.movement.locationCode
      ? ` (${result.movement.locationCode})`
      : '';

    setLastOperationBanner(
      `${verb}: ${result.movement.quantity} × ${result.movement.productSku} (${result.movement.productName})${cellNote}. Warehouse capacity is now ${result.warehouse.occupancyPercentage}% full.`,
    );

    await refreshWarehouses();
  };

  const handlePutawaySuccess = async (result: PutawayResultDto) => {
    if (!selectedWarehouse) return;
    setItems(result.inventory);
    setStagedItems(result.stagedItems);

    // Refresh locations in background
    warehouseApiService
      .fetchLocations(selectedWarehouse.id)
      .then((locs) => setLocations(locs))
      .catch(() => { });

    setLastOperationBanner(
      `Putaway completed: ${result.movement.quantity} × ${result.movement.productSku} placed into Cell ${result.cell.code}.`,
    );

    await refreshWarehouses();
  };

  if (!selectedWarehouse) return null;

  const totalStagedUnits = stagedItems.reduce((acc, s) => acc + s.stagedQuantity, 0);

  return (
    <>
      <div className="facility-heading-bar">
        <div>
          <h1>Warehouse Inventory</h1>
          <p className="facility-subline">
            Stock management and putaway control for {selectedWarehouse.name}
          </p>
        </div>

        <div className="heading-actions">
          <button
            type="button"
            className="primary-action-btn"
            onClick={() => openModal('INSERT')}
          >
            <Plus size={16} />
            <span>Receive Delivery / Adjust Stock</span>
          </button>
        </div>
      </div>

      {lastOperationBanner && (
        <div className="operation-status-strip tabular">
          <span>{lastOperationBanner}</span>
          <button
            type="button"
            className="strip-dismiss-btn"
            onClick={() => setLastOperationBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Segmented Control for In-Rack vs Staging Tabs */}
      <div
        className="segmented-control"
        role="tablist"
        aria-label="Inventory Sections"
        style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'IN_RACK'}
          className={`filter-tab ${activeTab === 'IN_RACK' ? 'active' : ''}`}
          onClick={() => setActiveTab('IN_RACK')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            fontWeight: activeTab === 'IN_RACK' ? 700 : 500,
          }}
        >
          <PackageCheck size={16} />
          <span>In-Rack Inventory</span>
          <span
            className="tag"
            style={{
              padding: '2px 8px',
              fontSize: '0.75rem',
              background: activeTab === 'IN_RACK' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
            }}
          >
            {items.length} SKUs
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'STAGING'}
          className={`filter-tab ${activeTab === 'STAGING' ? 'active' : ''}`}
          onClick={() => setActiveTab('STAGING')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            fontWeight: activeTab === 'STAGING' ? 700 : 500,
          }}
        >
          <Clock size={16} />
          <span>Pending Putaway (Staging)</span>
          <span
            className="tag"
            style={{
              padding: '2px 8px',
              fontSize: '0.75rem',
              background:
                totalStagedUnits > 0
                  ? 'rgba(245, 158, 11, 0.25)'
                  : 'rgba(255, 255, 255, 0.05)',
              color: totalStagedUnits > 0 ? '#fbbf24' : 'inherit',
              borderColor: totalStagedUnits > 0 ? '#f59e0b' : 'transparent',
              fontWeight: 700,
            }}
          >
            {totalStagedUnits > 0 ? `${totalStagedUnits} units waiting` : 'Empty'}
          </span>
        </button>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          className="filter-search"
          placeholder={
            activeTab === 'IN_RACK'
              ? 'Search SKU, product name, or category...'
              : 'Search staged items, supplier, PO reference...'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-summary mono tabular">
          {activeTab === 'IN_RACK'
            ? `${selectedWarehouse.formattedFullLabel} · ${selectedWarehouse.totalItemsCounter.toLocaleString()} racked units`
            : `${stagedItems.length} deliveries waiting in staging (${totalStagedUnits} units total)`}
        </div>
      </div>

      <div className="table-sheet">
        {isLoading ? (
          <div className="state-notice">Loading inventory...</div>
        ) : activeTab === 'IN_RACK' ? (
          /* TAB 1: IN-RACK INVENTORY TABLE */
          <table className="wms-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                <th>In-Rack Units</th>
                <th>Staged Units</th>
                <th>Total Stock</th>
                <th>Unit</th>
                <th>Updated</th>
                <th className="table-actions-col">Quick Adjust</th>
              </tr>
            </thead>
            <tbody>
              {filteredInRack.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="code-chip">{item.sku}</span>
                  </td>
                  <td>
                    <strong>{item.productName}</strong>
                  </td>
                  <td className="subtle-cell">{item.category}</td>
                  <td>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>
                      {(item.inRackQuantity ?? item.quantity).toLocaleString()}
                    </span>
                  </td>
                  <td>
                    {(item.stagedQuantity ?? 0) > 0 ? (
                      <span
                        className="tag"
                        style={{
                          color: '#fbbf24',
                          background: 'rgba(245, 158, 11, 0.15)',
                          borderColor: 'rgba(245, 158, 11, 0.3)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setActiveTab('STAGING')}
                        title="Click to view staged items and put away"
                      >
                        {item.stagedQuantity} waiting
                      </span>
                    ) : (
                      <span className="subtle-cell mono">0</span>
                    )}
                  </td>
                  <td>
                    <strong>{item.quantity.toLocaleString()}</strong>
                  </td>
                  <td className="subtle-cell mono">{item.unitOfMeasure}</td>
                  <td className="subtle-cell">
                    {new Date(item.updatedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="table-actions-col">
                    <div className="row-action-group">
                      <button
                        type="button"
                        className="row-adjust-btn add"
                        onClick={() => openModal('INSERT', item.productId)}
                      >
                        <Plus size={13} />
                        <span>Receive</span>
                      </button>
                      <button
                        type="button"
                        className="row-adjust-btn"
                        onClick={() => openModal('REMOVE', item.productId)}
                      >
                        <Minus size={13} />
                        <span>Dispatch</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredInRack.length === 0 && (
                <tr>
                  <td colSpan={9} className="state-notice">
                    {items.length === 0 ? (
                      <div className="empty-table-cta">
                        <p>No inventory items are stored in {selectedWarehouse.name} yet.</p>
                        <button
                          type="button"
                          className="primary-action-btn"
                          onClick={() => openModal('INSERT')}
                        >
                          Receive first delivery
                        </button>
                      </div>
                    ) : (
                      <>
                        No matching stock items in {selectedWarehouse.name}. Clear your search filter
                        to view all warehouse inventory.
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          /* TAB 2: PENDING PUTAWAY (STAGING) TABLE */
          <table className="wms-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Waiting to Put Away</th>
                <th>Supplier / Partner</th>
                <th>Delivery Reference</th>
                <th>Received At</th>
                <th className="table-actions-col">Putaway Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaged.map((staged) => (
                <tr key={staged.id}>
                  <td>
                    <span className="code-chip">{staged.sku}</span>
                  </td>
                  <td>
                    <strong>{staged.productName}</strong>
                  </td>
                  <td className="subtle-cell">{staged.category}</td>
                  <td>
                    <span
                      style={{
                        fontSize: '1.1rem',
                        fontWeight: 800,
                        color: '#fbbf24',
                      }}
                    >
                      {staged.stagedQuantity}{' '}
                      <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                        {staged.unitOfMeasure}
                      </span>
                    </span>
                  </td>
                  <td className="subtle-cell">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Truck size={14} className="icon-subtle" />
                      <span>{staged.partnerName}</span>
                    </div>
                  </td>
                  <td>
                    <span className="font-mono" style={{ fontSize: '0.85rem' }}>
                      {staged.referenceCode}
                    </span>
                  </td>
                  <td className="subtle-cell">
                    {new Date(staged.receivedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="table-actions-col">
                    <button
                      type="button"
                      className="button button-primary"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        gap: '6px',
                        fontWeight: 700,
                      }}
                      onClick={() => openPutaway(staged)}
                    >
                      <Boxes size={15} />
                      <span>Put Away / Shelve</span>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredStaged.length === 0 && (
                <tr>
                  <td colSpan={8} className="state-notice" style={{ padding: '36px 16px' }}>
                    <div style={{ textAlign: 'center' }}>
                      <PackageCheck
                        size={42}
                        style={{ color: '#10b981', margin: '0 auto 12px auto' }}
                      />
                      <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                        Staging Area is Clear!
                      </div>
                      <p
                        style={{
                          color: 'var(--text-muted, #94a3b8)',
                          fontSize: '0.9rem',
                          marginTop: '4px',
                        }}
                      >
                        All accepted deliveries have been unpacked and shelved into rack storage
                        cells.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Manual Insert/Remove modal */}
      <InventoryActionModal
        isOpen={isModalOpen}
        initialAction={modalAction}
        initialProductId={modalProductId}
        warehouse={selectedWarehouse}
        inventoryItems={items}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
      />

      {/* Putaway & QR Scanner modal */}
      <PutawayActionModal
        isOpen={isPutawayModalOpen}
        item={selectedPutawayItem}
        warehouse={selectedWarehouse}
        locations={locations}
        onClose={() => setIsPutawayModalOpen(false)}
        onSuccess={handlePutawaySuccess}
      />
    </>
  );
};
