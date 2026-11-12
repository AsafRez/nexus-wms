import React, { useEffect, useState } from 'react';
import { MovementRecordDto, MovementType } from '../../../shared/wms.contracts';
import { useWarehouse } from '../context/WarehouseContext';
import { warehouseApiService } from '../services/WarehouseApiService';

interface MovementsPageProps {
  movementType: MovementType;
}

export const MovementsPage: React.FC<MovementsPageProps> = ({ movementType }) => {
  const { selectedWarehouse, dataRevision } = useWarehouse();
  const [records, setRecords] = useState<MovementRecordDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedWarehouse) return;
    let cancelled = false;
    setIsLoading(true);

    warehouseApiService
      .fetchMovements(selectedWarehouse.id, movementType)
      .then((data) => {
        if (!cancelled) setRecords(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedWarehouse?.id, movementType, dataRevision]);

  if (!selectedWarehouse) return null;

  const isInbound = movementType === 'INBOUND';

  return (
    <>
      <div className="facility-heading-bar">
        <div>
          <h1>{isInbound ? 'Inbound receiving' : 'Outbound dispatch'}</h1>
          <p className="facility-subline">
            {isInbound
              ? `Supplier shipments arriving at ${selectedWarehouse.name}`
              : `Customer orders leaving ${selectedWarehouse.name}`}
          </p>
        </div>
        <span className="panel-count">{records.length} manifest lines</span>
      </div>

      <div className="table-sheet">
        {isLoading ? (
          <div className="state-notice">Loading {movementType.toLowerCase()} manifest...</div>
        ) : (
          <table className="wms-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>{isInbound ? 'Supplier' : 'Destination'}</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Status</th>
                <th>Logged</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id}>
                  <td>
                    <span className="code-chip">{rec.referenceCode}</span>
                  </td>
                  <td>{rec.partnerName}</td>
                  <td>
                    <div>
                      <strong>{rec.productName}</strong>
                    </div>
                    <div className="subtle-cell mono" style={{ fontSize: '11.5px' }}>
                      {rec.productSku}
                    </div>
                  </td>
                  <td>
                    <span className={isInbound ? 'delta-in' : 'delta-out'}>
                      {isInbound ? '+' : '-'}
                      {rec.quantity}
                    </span>
                  </td>
                  <td className="subtle-cell">{rec.status.toLowerCase().replace('_', ' ')}</td>
                  <td className="subtle-cell">
                    {new Date(rec.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={6} className="state-notice">
                    No {movementType.toLowerCase()} movements recorded for {selectedWarehouse.name}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};
