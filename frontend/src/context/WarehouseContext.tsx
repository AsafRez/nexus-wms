import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { WarehouseViewModel } from '../models/WarehouseViewModel';
import { warehouseApiService } from '../services/WarehouseApiService';
import { useAuth } from './AuthContext';

interface WarehouseContextValue {
  warehouses: WarehouseViewModel[];
  selectedWarehouse: WarehouseViewModel | null;
  isLoadingWarehouses: boolean;
  dataRevision: number;
  selectWarehouse: (warehouseId: string) => void;
  refreshWarehouses: () => Promise<void>;
}

const WarehouseContext = createContext<WarehouseContextValue | undefined>(undefined);

export const WarehouseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<WarehouseViewModel[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState<boolean>(false);
  const [dataRevision, setDataRevision] = useState<number>(0);

  const loadWarehouses = useCallback(async () => {
    if (!user) {
      setWarehouses([]);
      setSelectedWarehouseId(null);
      return;
    }

    setIsLoadingWarehouses(true);
    try {
      const list = await warehouseApiService.fetchWarehouses();
      setWarehouses(list);

      setSelectedWarehouseId((prevId) => {
        if (prevId && list.some((w) => w.id === prevId)) {
          return prevId;
        }
        return list[0]?.id ?? null;
      });
    } catch (err) {
      console.error('Failed to load business warehouses:', err);
    } finally {
      setIsLoadingWarehouses(false);
    }
  }, [user]);

  useEffect(() => {
    loadWarehouses();
  }, [loadWarehouses]);

  const refreshWarehouses = useCallback(async () => {
    await loadWarehouses();
    setDataRevision((v) => v + 1);
  }, [loadWarehouses]);

  const selectWarehouse = (warehouseId: string) => {
    setSelectedWarehouseId(warehouseId);
  };

  const selectedWarehouse =
    warehouses.find((w) => w.id === selectedWarehouseId) ?? warehouses[0] ?? null;

  return (
    <WarehouseContext.Provider
      value={{
        warehouses,
        selectedWarehouse,
        isLoadingWarehouses,
        dataRevision,
        selectWarehouse,
        refreshWarehouses,
      }}
    >
      {children}
    </WarehouseContext.Provider>
  );
};

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) {
    throw new Error('useWarehouse must be used inside a WarehouseProvider');
  }
  return ctx;
}
