import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import {
  AdjustInventoryResultDto,
  InventoryActionType,
  WarehouseInventoryItemDto,
} from '../../../shared/wms.contracts';
import { InventoryActionModal } from '../components/inventory/InventoryActionModal';
import { useWarehouse } from '../context/WarehouseContext';
import { warehouseApiService } from '../services/WarehouseApiService';

export const InventoryPage: React.FC = () => {
  const { selectedWarehouse, refreshWarehouses, dataRevision } = useWarehouse();
  const [items, setItems] = useState<WarehouseInventoryItemDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalAction, setModalAction] = useState<InventoryActionType>('INSERT');
  const [modalProductId, setModalProductId] = useState<string | undefined>(undefined);
  const [lastOperationBanner, setLastOperationBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedWarehouse) return;
    let cancelled = false;
    setIsLoading(true);
    setLastOperationBanner(null);

    warehouseApiService
      .fetchInventory(selectedWarehouse.id)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWarehouse?.id, dataRevision]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) ||
        i.productName.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [items, query]);

  const openModal = (action: InventoryActionType, productId?: string) => {
    setModalAction(action);
    setModalProductId(productId);
    setIsModalOpen(true);
  };

  const handleModalSuccess = async (result: AdjustInventoryResultDto) => {
    setItems(result.inventory);
    setIsModalOpen(false);

    const verb = result.movement.type === 'INBOUND' ? 'Inserted' : 'Removed';
    const cellNote = result.movement.locationCode
      ? result.movement.type === 'INBOUND'
        ? ` into cell ${result.movement.locationCode}`
        : ` from cell ${result.movement.locationCode}`
      : '';
    setLastOperationBanner(
      `${verb} ${result.movement.quantity} × ${result.movement.productSku} (${result.movement.productName})${cellNote}. Warehouse capacity is now ${result.warehouse.occupancyPercentage}% full.`,
    );

    await refreshWarehouses();
  };

  if (!selectedWarehouse) return null;

  return (
    <>
      <div className="facility-heading-bar">
        <div>
          <h1>Warehouse inventory</h1>
          <p className="facility-subline">
            Current catalog stock held in {selectedWarehouse.name} ({items.length} SKUs)
          </p>
        </div>

        <div className="heading-actions">
          <button
            type="button"
            className="primary-action-btn"
            onClick={() => openModal('INSERT')}
          >
            <Plus size={16} />
            <span>Insert / remove item</span>
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

      <div className="filter-bar">
        <input
          type="search"
          className="filter-search"
          placeholder="Search SKU, product name, or category..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-summary mono tabular">
          {selectedWarehouse.formattedFullLabel} · {selectedWarehouse.totalItemsCounter.toLocaleString()} cell units
        </div>
      </div>

      <div className="table-sheet">
        {isLoading ? (
          <div className="state-notice">Loading warehouse inventory...</div>
        ) : (
          <table className="wms-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Category</th>
                <th>Quantity in warehouse</th>
                <th>Unit</th>
                <th>Updated</th>
                <th className="table-actions-col">Quick adjust</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="code-chip">{item.sku}</span>
                  </td>
                  <td>
                    <strong>{item.productName}</strong>
                  </td>
                  <td className="subtle-cell">{item.category}</td>
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
                        <span>Insert</span>
                      </button>
                      <button
                        type="button"
                        className="row-adjust-btn"
                        onClick={() => openModal('REMOVE', item.productId)}
                      >
                        <Minus size={13} />
                        <span>Remove</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="state-notice">
                    {items.length === 0 ? (
                      <div className="empty-table-cta">
                        <p>No inventory items are stored in {selectedWarehouse.name} yet.</p>
                        <button
                          type="button"
                          className="primary-action-btn"
                          onClick={() => openModal('INSERT')}
                        >
                          Insert first item into cell
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
        )}
      </div>

      <InventoryActionModal
        isOpen={isModalOpen}
        initialAction={modalAction}
        initialProductId={modalProductId}
        warehouse={selectedWarehouse}
        inventoryItems={items}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
      />
    </>
  );
};
