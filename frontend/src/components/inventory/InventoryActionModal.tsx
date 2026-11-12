import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Plus,
  RefreshCw,
  ScanLine,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AdjustInventoryResultDto,
  AnalyzedOrderLineItemDto,
  AnalyzeOrderImageResponseDto,
  InventoryActionType,
  ProductCatalogItemDto,
  StorageLocationDto,
  WarehouseInventoryItemDto,
} from '../../../../shared/wms.contracts';
import { WarehouseViewModel } from '../../models/WarehouseViewModel';
import { aiApiService } from '../../services/AiApiService';
import { warehouseApiService } from '../../services/WarehouseApiService';
import { generateSampleOrderSlipPng } from './orderSlipSampleGenerator';

type ModalTabMode = InventoryActionType | 'ORDER_SCAN';

interface EditableOrderLine {
  id: string;
  productId: string;
  isNewSku: boolean;
  sku: string;
  productName: string;
  category: string;
  unitOfMeasure: string;
  quantity: number;
  cellCoord: string; // "row:col" or "NONE" or ""
  confidenceNote: string;
  rawText: string;
  applied: boolean;
}

interface InventoryActionModalProps {
  isOpen: boolean;
  initialAction: InventoryActionType;
  initialProductId?: string;
  warehouse: WarehouseViewModel;
  inventoryItems: WarehouseInventoryItemDto[];
  onClose: () => void;
  onSuccess: (result: AdjustInventoryResultDto) => void;
}

export const InventoryActionModal: React.FC<InventoryActionModalProps> = ({
  isOpen,
  initialAction,
  initialProductId,
  warehouse,
  inventoryItems,
  onClose,
  onSuccess,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [modalTab, setModalTab] = useState<ModalTabMode>(initialAction);
  const [action, setAction] = useState<InventoryActionType>(initialAction);
  const [catalog, setCatalog] = useState<ProductCatalogItemDto[]>([]);
  const [locations, setLocations] = useState<StorageLocationDto[]>([]);
  const [isLoadingContext, setIsLoadingContext] = useState<boolean>(false);

  // Manual single-item selection state
  const [isCreatingNewSku, setIsCreatingNewSku] = useState<boolean>(false);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [newSku, setNewSku] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>('General Cargo');
  const [newUnit, setNewUnit] = useState<string>('PCS');

  // Manual cell & quantity state
  const [selectedCellCoord, setSelectedCellCoord] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(5);
  const [partnerName, setPartnerName] = useState<string>('');

  // AI Order Image Scan & Review state
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState<boolean>(false);
  const [orderAnalysis, setOrderAnalysis] = useState<AnalyzeOrderImageResponseDto | null>(null);
  const [orderAction, setOrderAction] = useState<InventoryActionType>('INSERT');
  const [orderPartner, setOrderPartner] = useState<string>('');
  const [orderLines, setOrderLines] = useState<EditableOrderLine[]>([]);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Open/close native <dialog> for accessible focus management and Escape handling
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    try {
      if (isOpen) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    } catch (err) {
      console.warn('InventoryActionModal showModal/close error:', err);
    }
  }, [isOpen]);

  // Reset & load catalog + matrix cells whenever modal opens for the active warehouse
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setModalTab(initialAction);
    setAction(initialAction);
    setIsCreatingNewSku(false);
    setQuantity(5);
    setPartnerName('');
    setUploadedPreviewUrl(null);
    setUploadedFileName('');
    setIsAnalyzingImage(false);
    setOrderAnalysis(null);
    setOrderLines([]);
    setErrorMsg(null);
    setIsLoadingContext(true);

    Promise.all([
      warehouseApiService.fetchCatalog(warehouse.id),
      warehouseApiService.fetchLocations(warehouse.id),
    ])
      .then(([catalogData, locationsData]) => {
        if (cancelled) return;
        setCatalog(catalogData);
        setLocations(locationsData);

        if (initialAction === 'INSERT') {
          const defaultProd = initialProductId || catalogData[0]?.id || '';
          setSelectedProductId(defaultProd);
          if (catalogData.length === 0) {
            setIsCreatingNewSku(true);
          }
          const firstOpen =
            locationsData.find((c) => !c.isOccupied) ??
            locationsData.find((c) => c.currentItems < c.maxUnits);
          setSelectedCellCoord(firstOpen ? `${firstOpen.row}:${firstOpen.col}` : '');
        } else {
          const defaultRemoveProd = initialProductId || inventoryItems[0]?.productId || '';
          setSelectedProductId(defaultRemoveProd);
          const firstMatching = locationsData.find(
            (c) => c.currentItems > 0 && c.product?.productId === defaultRemoveProd,
          );
          setSelectedCellCoord(
            firstMatching ? `${firstMatching.row}:${firstMatching.col}` : 'NONE',
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load warehouse cells.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingContext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, warehouse.id, initialAction, initialProductId, inventoryItems]);

  // Switch between INSERT, REMOVE, and ORDER_SCAN tabs
  const handleModeSwitch = (nextTab: ModalTabMode) => {
    setModalTab(nextTab);
    setErrorMsg(null);

    if (nextTab === 'ORDER_SCAN') {
      return;
    }

    setAction(nextTab);
    if (nextTab === 'INSERT') {
      if (!selectedProductId && catalog.length > 0) {
        setSelectedProductId(catalog[0].id);
      }
      const firstOpen =
        locations.find((c) => !c.isOccupied) ??
        locations.find((c) => c.currentItems < c.maxUnits);
      setSelectedCellCoord(firstOpen ? `${firstOpen.row}:${firstOpen.col}` : '');
    } else {
      setIsCreatingNewSku(false);
      const validInStock = inventoryItems.some((i) => i.productId === selectedProductId);
      const targetProdId = validInStock ? selectedProductId : inventoryItems[0]?.productId ?? '';
      setSelectedProductId(targetProdId);
      const firstMatching = locations.find(
        (c) => c.currentItems > 0 && c.product?.productId === targetProdId,
      );
      setSelectedCellCoord(firstMatching ? `${firstMatching.row}:${firstMatching.col}` : 'NONE');
    }
  };

  // Build 2D matrix [row][col] from flat locations for visual cell selection
  const matrixRows = useMemo(() => {
    const grid: StorageLocationDto[][] = Array.from({ length: warehouse.rows }, () => []);
    for (const loc of locations) {
      if (loc.row >= 0 && loc.row < warehouse.rows && loc.col >= 0 && loc.col < warehouse.cols) {
        grid[loc.row][loc.col] = loc;
      }
    }
    return grid;
  }, [locations, warehouse.rows, warehouse.cols]);

  const inventoryByProductId = useMemo(() => {
    const map = new Map<string, WarehouseInventoryItemDto>();
    for (const item of inventoryItems) {
      map.set(item.productId, item);
    }
    return map;
  }, [inventoryItems]);

  const catalogById = useMemo(() => {
    const map = new Map<string, ProductCatalogItemDto>();
    for (const prod of catalog) {
      map.set(prod.id, prod);
    }
    return map;
  }, [catalog]);

  const selectedCell = useMemo(() => {
    if (!selectedCellCoord || selectedCellCoord === 'NONE') return null;
    const [rStr, cStr] = selectedCellCoord.split(':');
    const r = Number(rStr);
    const c = Number(cStr);
    return locations.find((loc) => loc.row === r && loc.col === c) ?? null;
  }, [locations, selectedCellCoord]);

  const isCellValidForSelection = (
    loc: StorageLocationDto,
    mode: InventoryActionType = action,
    prodId: string = selectedProductId,
    creatingNew: boolean = isCreatingNewSku,
  ): boolean => {
    if (mode === 'INSERT') {
      if (creatingNew) {
        return !loc.isOccupied;
      }
      return (
        loc.currentItems < loc.maxUnits &&
        (!loc.isOccupied || !loc.product || loc.product.productId === prodId)
      );
    }
    return loc.currentItems > 0 && (!loc.product || loc.product.productId === prodId);
  };

  const handleProductChange = (nextProdId: string) => {
    setSelectedProductId(nextProdId);
    setErrorMsg(null);
    if (!selectedCell || !isCellValidForSelection(selectedCell, action, nextProdId, false)) {
      const candidate =
        action === 'INSERT'
          ? (locations.find((c) => !c.isOccupied) ??
            locations.find((c) => isCellValidForSelection(c, 'INSERT', nextProdId, false)))
          : locations.find((c) => isCellValidForSelection(c, 'REMOVE', nextProdId, false));
      setSelectedCellCoord(
        candidate ? `${candidate.row}:${candidate.col}` : action === 'REMOVE' ? 'NONE' : '',
      );
    }
  };

  const selectedRemoveItem = useMemo(() => {
    if (action !== 'REMOVE') return null;
    return inventoryByProductId.get(selectedProductId) ?? null;
  }, [action, inventoryByProductId, selectedProductId]);

  const maxAllowedQuantity = useMemo(() => {
    if (action === 'INSERT') {
      if (!selectedCell) return 100;
      return Math.max(0, selectedCell.maxUnits - selectedCell.currentItems);
    }
    const maxByStock = selectedRemoveItem?.quantity ?? 0;
    if (!selectedCell) return maxByStock;
    return Math.min(maxByStock, selectedCell.currentItems);
  }, [action, selectedCell, selectedRemoveItem]);

  // =========================================================================
  // AI ORDER CONFIRMATION UPLOAD, ANALYSIS & EDITABLE LINE RECONCILIATION
  // =========================================================================

  /**
   * Computes a valid cell coordinate for a line item while avoiding collisions
   * with empty cells already claimed by earlier lines of a DIFFERENT SKU.
   */
  const pickBestCellForOrderLine = (
    direction: InventoryActionType,
    productId: string,
    isNewSku: boolean,
    skuKey: string,
    qty: number,
    claimedCoordsBySku: Map<string, string>,
  ): string => {
    const normalizedSku = skuKey.trim().toUpperCase();
    if (direction === 'INSERT') {
      if (!isNewSku && productId) {
        const sameSkuCell = locations.find(
          (loc) =>
            loc.isOccupied &&
            loc.product?.productId === productId &&
            loc.currentItems + qty <= loc.maxUnits,
        );
        if (sameSkuCell) {
          return `${sameSkuCell.row}:${sameSkuCell.col}`;
        }
      }

      const emptyCell = locations.find((loc) => {
        if (loc.isOccupied) return false;
        const coord = `${loc.row}:${loc.col}`;
        const claimedSku = claimedCoordsBySku.get(coord);
        return !claimedSku || (normalizedSku && claimedSku === normalizedSku);
      });
      if (emptyCell) {
        const coord = `${emptyCell.row}:${emptyCell.col}`;
        if (normalizedSku) {
          claimedCoordsBySku.set(coord, normalizedSku);
        }
        return coord;
      }
      return '';
    }

    // Outbound REMOVE: pull from a cell holding this exact product, else ledger-only
    if (productId) {
      const exactEnough = locations.find(
        (loc) =>
          loc.currentItems >= qty &&
          loc.product?.productId === productId,
      );
      if (exactEnough) {
        return `${exactEnough.row}:${exactEnough.col}`;
      }
      const anyMatching = locations.find(
        (loc) => loc.currentItems > 0 && loc.product?.productId === productId,
      );
      if (anyMatching) {
        return `${anyMatching.row}:${anyMatching.col}`;
      }
    }
    return 'NONE';
  };

  const mapAnalyzedItemsToEditableLines = (
    items: AnalyzedOrderLineItemDto[],
    direction: InventoryActionType,
  ): EditableOrderLine[] => {
    const claimedCoords = new Map<string, string>();
    return items.map((item, idx) => {
      const matchedId = item.matchedProductId ?? '';
      let isNew = direction === 'INSERT' ? item.isNewSku || !matchedId : false;
      let resolvedProdId = matchedId;

      if (direction === 'REMOVE') {
        const inStock = inventoryItems.find(
          (inv) =>
            inv.productId === matchedId ||
            inv.sku.toUpperCase() === item.sku.trim().toUpperCase(),
        );
        resolvedProdId = inStock?.productId ?? inventoryItems[0]?.productId ?? '';
        isNew = false;
      } else if (!isNew && !catalogById.has(resolvedProdId)) {
        isNew = true;
        resolvedProdId = '';
      }

      let cellCoord =
        item.suggestedRow !== null && item.suggestedCol !== null
          ? `${item.suggestedRow}:${item.suggestedCol}`
          : '';

      if (cellCoord) {
        claimedCoords.set(cellCoord, item.sku.trim().toUpperCase());
      } else {
        cellCoord = pickBestCellForOrderLine(
          direction,
          resolvedProdId,
          isNew,
          item.sku,
          item.quantity,
          claimedCoords,
        );
      }

      return {
        id: item.lineId || `line-${idx + 1}-${Date.now()}`,
        productId: resolvedProdId,
        isNewSku: isNew,
        sku: item.sku,
        productName: item.productName,
        category: item.category || 'General Cargo',
        unitOfMeasure: item.unitOfMeasure || 'PCS',
        quantity: Math.max(1, Math.round(item.quantity || 1)),
        cellCoord,
        confidenceNote: item.confidenceNote,
        rawText: item.rawText,
        applied: false,
      };
    });
  };

  const runOrderImageAnalysis = async (
    dataUrl: string,
    mimeType: string,
    fileName: string,
  ) => {
    setErrorMsg(null);
    setUploadedPreviewUrl(dataUrl);
    setUploadedFileName(fileName);
    setOrderAnalysis(null);
    setOrderLines([]);
    setIsAnalyzingImage(true);

    try {
      const response = await aiApiService.analyzeOrderImage(warehouse.id, {
        imageBase64: dataUrl,
        mimeType,
        fileName,
        hintAction: action,
      });

      setOrderAnalysis(response);
      setOrderAction(response.detectedAction);
      setOrderPartner(response.partnerName?.trim() || '');

      const mapped = mapAnalyzedItemsToEditableLines(
        response.items,
        response.detectedAction,
      );
      setOrderLines(mapped);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not analyze the uploaded order image.',
      );
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleImageFileSelected = (file: File | null | undefined) => {
    if (!file) return;
    const isPdfByName = file.name.toLowerCase().endsWith('.pdf');
    const allowedMimes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'application/pdf',
    ];
    if (!allowedMimes.includes(file.type.toLowerCase()) && !isPdfByName) {
      setErrorMsg('Unsupported file format. Please upload a PDF, PNG, JPG, or WEBP order document.');
      return;
    }
    if (file.size > 18 * 1024 * 1024) {
      setErrorMsg('File exceeds 18 MB limit. Please upload a smaller document.');
      return;
    }

    const effectiveMime = isPdfByName ? 'application/pdf' : file.type || 'application/pdf';

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        void runOrderImageAnalysis(reader.result, effectiveMime, file.name);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read the selected file.');
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateSampleAndAnalyze = (kind: 'INBOUND' | 'OUTBOUND') => {
    try {
      const sample = generateSampleOrderSlipPng(
        kind,
        warehouse.name,
        warehouse.code,
        catalog,
        inventoryItems,
      );
      void runOrderImageAnalysis(sample.dataUrl, sample.mimeType, sample.fileName);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not generate sample order image.',
      );
    }
  };

  const handleOrderDirectionSwitch = (nextDir: InventoryActionType) => {
    setOrderAction(nextDir);
    setErrorMsg(null);
    const claimedCoords = new Map<string, string>();

    setOrderLines((prev) =>
      prev.map((line) => {
        if (line.applied) return line;

        let nextProdId = line.productId;
        let nextIsNew = line.isNewSku;
        let nextSku = line.sku;
        let nextName = line.productName;
        let nextUnit = line.unitOfMeasure;

        if (nextDir === 'REMOVE') {
          nextIsNew = false;
          const matchingInv =
            inventoryItems.find((i) => i.productId === line.productId) ??
            inventoryItems.find(
              (i) => i.sku.toUpperCase() === line.sku.trim().toUpperCase(),
            ) ??
            inventoryItems[0];
          nextProdId = matchingInv?.productId ?? '';
          if (matchingInv) {
            nextSku = matchingInv.sku;
            nextName = matchingInv.productName;
            nextUnit = matchingInv.unitOfMeasure;
          }
        } else if (!nextIsNew && !nextProdId) {
          if (catalog[0]) {
            nextProdId = catalog[0].id;
            nextSku = catalog[0].sku;
            nextName = catalog[0].name;
            nextUnit = catalog[0].unitOfMeasure;
          } else {
            nextIsNew = true;
          }
        }

        const nextCell = pickBestCellForOrderLine(
          nextDir,
          nextProdId,
          nextIsNew,
          nextSku,
          line.quantity,
          claimedCoords,
        );

        return {
          ...line,
          productId: nextProdId,
          isNewSku: nextIsNew,
          sku: nextSku,
          productName: nextName,
          unitOfMeasure: nextUnit,
          cellCoord: nextCell,
        };
      }),
    );
  };

  const updateOrderLine = (lineId: string, patch: Partial<EditableOrderLine>) => {
    setErrorMsg(null);
    setOrderLines((prev) =>
      prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    );
  };

  const handleOrderLineProductSelect = (lineId: string, selectedValue: string) => {
    setErrorMsg(null);
    setOrderLines((prev) => {
      const claimedCoords = new Map<string, string>();
      prev.forEach((other) => {
        if (other.id !== lineId && other.cellCoord && other.cellCoord !== 'NONE') {
          claimedCoords.set(other.cellCoord, other.sku.trim().toUpperCase());
        }
      });

      return prev.map((line) => {
        if (line.id !== lineId) return line;

        if (selectedValue === '__NEW_SKU__') {
          const suggested = pickBestCellForOrderLine(
            'INSERT',
            '',
            true,
            line.sku || `NEW-${Date.now()}`,
            line.quantity,
            claimedCoords,
          );
          return {
            ...line,
            isNewSku: true,
            productId: '',
            cellCoord: suggested,
          };
        }

        if (orderAction === 'INSERT') {
          const prod = catalogById.get(selectedValue);
          const skuCode = prod?.sku ?? line.sku;
          const suggested = pickBestCellForOrderLine(
            'INSERT',
            selectedValue,
            false,
            skuCode,
            line.quantity,
            claimedCoords,
          );
          return {
            ...line,
            isNewSku: false,
            productId: selectedValue,
            sku: prod?.sku ?? line.sku,
            productName: prod?.name ?? line.productName,
            category: prod?.category ?? line.category,
            unitOfMeasure: prod?.unitOfMeasure ?? line.unitOfMeasure,
            cellCoord: suggested,
          };
        }

        const invItem = inventoryByProductId.get(selectedValue);
        const suggestedRemoveCell = pickBestCellForOrderLine(
          'REMOVE',
          selectedValue,
          false,
          invItem?.sku ?? line.sku,
          line.quantity,
          claimedCoords,
        );
        return {
          ...line,
          isNewSku: false,
          productId: selectedValue,
          sku: invItem?.sku ?? line.sku,
          productName: invItem?.productName ?? line.productName,
          unitOfMeasure: invItem?.unitOfMeasure ?? line.unitOfMeasure,
          cellCoord: suggestedRemoveCell,
        };
      });
    });
  };

  const handleAddOrderLine = () => {
    setErrorMsg(null);
    const claimedCoords = new Map<string, string>();
    orderLines.forEach((l) => {
      if (l.cellCoord && l.cellCoord !== 'NONE') {
        claimedCoords.set(l.cellCoord, l.sku.trim().toUpperCase());
      }
    });

    if (orderAction === 'INSERT') {
      const defaultProd = catalog[0];
      const isNew = !defaultProd;
      const skuVal = defaultProd?.sku ?? '';
      const cellCoord = pickBestCellForOrderLine(
        'INSERT',
        defaultProd?.id ?? '',
        isNew,
        skuVal || `ADDED-${orderLines.length + 1}`,
        5,
        claimedCoords,
      );
      setOrderLines((prev) => [
        ...prev,
        {
          id: `manual-line-${Date.now()}`,
          productId: defaultProd?.id ?? '',
          isNewSku: isNew,
          sku: skuVal,
          productName: defaultProd?.name ?? '',
          category: defaultProd?.category ?? 'General Cargo',
          unitOfMeasure: defaultProd?.unitOfMeasure ?? 'PCS',
          quantity: 5,
          cellCoord,
          confidenceNote: 'Added manually during confirmation',
          rawText: 'Manual line addition',
          applied: false,
        },
      ]);
    } else {
      const defaultInv = inventoryItems[0];
      const cellCoord = pickBestCellForOrderLine(
        'REMOVE',
        defaultInv?.productId ?? '',
        false,
        defaultInv?.sku ?? '',
        1,
        claimedCoords,
      );
      setOrderLines((prev) => [
        ...prev,
        {
          id: `manual-line-${Date.now()}`,
          productId: defaultInv?.productId ?? '',
          isNewSku: false,
          sku: defaultInv?.sku ?? '',
          productName: defaultInv?.productName ?? '',
          category: defaultInv?.category ?? 'General Cargo',
          unitOfMeasure: defaultInv?.unitOfMeasure ?? 'PCS',
          quantity: 1,
          cellCoord,
          confidenceNote: 'Added manually during confirmation',
          rawText: 'Manual line addition',
          applied: false,
        },
      ]);
    }
  };

  const handleRemoveOrderLine = (lineId: string) => {
    setErrorMsg(null);
    setOrderLines((prev) => prev.filter((line) => line.id !== lineId));
  };

  const isCellSelectableForOrderLine = (
    loc: StorageLocationDto,
    line: EditableOrderLine,
  ): boolean => {
    const coord = `${loc.row}:${loc.col}`;
    const lineIdentity = line.isNewSku
      ? `NEW:${line.sku.trim().toUpperCase() || line.id}`
      : `PROD:${line.productId}`;

    if (orderAction === 'INSERT') {
      // Prevent two different SKUs in the same order from claiming the same cell
      const conflictingSibling = orderLines.some((other) => {
        if (other.id === line.id || other.applied || other.cellCoord !== coord) return false;
        const otherIdentity = other.isNewSku
          ? `NEW:${other.sku.trim().toUpperCase() || other.id}`
          : `PROD:${other.productId}`;
        return otherIdentity !== lineIdentity;
      });
      if (conflictingSibling) return false;

      if (line.isNewSku) {
        return !loc.isOccupied;
      }
      return (
        loc.currentItems < loc.maxUnits &&
        (!loc.isOccupied || !loc.product || loc.product.productId === line.productId)
      );
    }

    return loc.currentItems > 0 && (!loc.product || loc.product.productId === line.productId);
  };

  const handleConfirmOrderBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const pendingLines = orderLines.filter((l) => !l.applied);
    if (pendingLines.length === 0) {
      setErrorMsg('Add at least one order line item to confirm.');
      return;
    }

    // Pre-flight batch validation across all pending lines (cumulative cell & stock checks)
    const cumulativeCellDelta = new Map<string, { qty: number; identity: string; label: string }>();
    const cumulativeRemoveByProd = new Map<string, number>();

    for (let i = 0; i < pendingLines.length; i += 1) {
      const line = pendingLines[i];
      const lineLabel = `Line #${i + 1}`;

      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        setErrorMsg(`${lineLabel}: Quantity must be a whole number of at least 1.`);
        return;
      }

      if (orderAction === 'INSERT') {
        if (line.isNewSku) {
          if (!line.sku.trim() || !line.productName.trim()) {
            setErrorMsg(`${lineLabel}: Enter both a SKU code and a product name for the new item.`);
            return;
          }
        } else if (!line.productId) {
          setErrorMsg(`${lineLabel}: Select a catalog item or switch to "+ Create new SKU".`);
          return;
        }

        if (!line.cellCoord || line.cellCoord === 'NONE') {
          setErrorMsg(`${lineLabel}: Select a target storage cell in the warehouse matrix.`);
          return;
        }

        const [rStr, cStr] = line.cellCoord.split(':');
        const cell = locations.find((c) => c.row === Number(rStr) && c.col === Number(cStr));
        if (!cell) {
          setErrorMsg(`${lineLabel}: Selected storage cell was not found.`);
          return;
        }

        const lineIdentity = line.isNewSku
          ? `NEW:${line.sku.trim().toUpperCase()}`
          : `PROD:${line.productId}`;

        if (
          cell.isOccupied &&
          cell.product &&
          (line.isNewSku || cell.product.productId !== line.productId)
        ) {
          setErrorMsg(
            `${lineLabel}: Cell ${cell.code} already stores ${cell.product.sku} (1-product-per-cell rule). Choose an open cell.`,
          );
          return;
        }

        const prevCellClaim = cumulativeCellDelta.get(line.cellCoord);
        if (prevCellClaim && prevCellClaim.identity !== lineIdentity) {
          setErrorMsg(
            `${lineLabel}: Cell ${cell.code} is already assigned to another SKU in this order (${prevCellClaim.label}). Pick a separate cell.`,
          );
          return;
        }

        const nextCellQty = (prevCellClaim?.qty ?? 0) + line.quantity;
        const remaining = cell.maxUnits - cell.currentItems;
        if (nextCellQty > remaining) {
          setErrorMsg(
            `${lineLabel}: Cell ${cell.code} only has capacity for ${remaining} more unit(s) (${cell.currentItems}/${cell.maxUnits}).`,
          );
          return;
        }

        cumulativeCellDelta.set(line.cellCoord, {
          qty: nextCellQty,
          identity: lineIdentity,
          label: line.sku || line.productName,
        });
      } else {
        if (!line.productId) {
          setErrorMsg(`${lineLabel}: Select an in-stock warehouse item to remove.`);
          return;
        }
        const stockItem = inventoryByProductId.get(line.productId);
        if (!stockItem) {
          setErrorMsg(`${lineLabel}: Selected item is not currently in warehouse stock.`);
          return;
        }

        const nextRemovedForProd =
          (cumulativeRemoveByProd.get(line.productId) ?? 0) + line.quantity;
        if (nextRemovedForProd > stockItem.quantity) {
          setErrorMsg(
            `${lineLabel}: Cannot remove ${nextRemovedForProd} units of ${stockItem.sku} — only ${stockItem.quantity} ${stockItem.unitOfMeasure} available in stock.`,
          );
          return;
        }
        cumulativeRemoveByProd.set(line.productId, nextRemovedForProd);

        if (line.cellCoord && line.cellCoord !== 'NONE') {
          const [rStr, cStr] = line.cellCoord.split(':');
          const cell = locations.find((c) => c.row === Number(rStr) && c.col === Number(cStr));
          if (!cell) {
            setErrorMsg(`${lineLabel}: Selected source cell was not found.`);
            return;
          }
          const nextPulledFromCell =
            (cumulativeCellDelta.get(line.cellCoord)?.qty ?? 0) + line.quantity;
          if (nextPulledFromCell > cell.currentItems) {
            setErrorMsg(
              `${lineLabel}: Cell ${cell.code} only holds ${cell.currentItems} unit(s). Lower quantity or switch cell to "Inventory ledger only".`,
            );
            return;
          }
          cumulativeCellDelta.set(line.cellCoord, {
            qty: nextPulledFromCell,
            identity: `PROD:${line.productId}`,
            label: stockItem.sku,
          });
        }
      }
    }

    setIsSubmitting(true);
    let lastResult: AdjustInventoryResultDto | null = null;
    try {
      for (const line of pendingLines) {
        const hasCell = Boolean(line.cellCoord && line.cellCoord !== 'NONE');
        const [rStr, cStr] = hasCell ? line.cellCoord.split(':') : ['', ''];

        const result = await warehouseApiService.adjustInventory(warehouse.id, {
          action: orderAction,
          productId: orderAction === 'INSERT' && line.isNewSku ? undefined : line.productId,
          newProduct:
            orderAction === 'INSERT' && line.isNewSku
              ? {
                  sku: line.sku.trim().toUpperCase(),
                  name: line.productName.trim(),
                  category: line.category.trim() || 'General Cargo',
                  unitOfMeasure: line.unitOfMeasure.trim().toUpperCase() || 'PCS',
                }
              : undefined,
          quantity: line.quantity,
          row: hasCell ? Number(rStr) : undefined,
          col: hasCell ? Number(cStr) : undefined,
          partnerName: orderPartner.trim() || undefined,
        });

        lastResult = result;
        setOrderLines((prev) =>
          prev.map((item) => (item.id === line.id ? { ...item, applied: true } : item)),
        );
      }

      if (lastResult) {
        onSuccess(lastResult);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed while applying order confirmation to warehouse stock.',
      );
      // Refresh live locations & catalog in case earlier lines succeeded
      Promise.all([
        warehouseApiService.fetchCatalog(warehouse.id),
        warehouseApiService.fetchLocations(warehouse.id),
      ])
        .then(([freshCat, freshLocs]) => {
          setCatalog(freshCat);
          setLocations(freshLocs);
        })
        .catch(() => undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  // =========================================================================
  // MANUAL SINGLE-ITEM SUBMIT
  // =========================================================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      setErrorMsg('Enter a whole number quantity of at least 1.');
      return;
    }

    if (action === 'INSERT') {
      if (!selectedCell) {
        setErrorMsg('Select a storage cell in the matrix where these items will be placed.');
        return;
      }
      const remaining = selectedCell.maxUnits - selectedCell.currentItems;
      if (quantity > remaining) {
        setErrorMsg(
          `Cell ${selectedCell.code} only has space for ${remaining} more unit(s) (${selectedCell.currentItems}/${selectedCell.maxUnits}).`,
        );
        return;
      }
      if (isCreatingNewSku) {
        if (!newSku.trim() || !newName.trim()) {
          setErrorMsg('Enter both a SKU code and a product name for the new item.');
          return;
        }
      } else if (!selectedProductId) {
        setErrorMsg('Select a product from the catalog.');
        return;
      }
    } else {
      if (!selectedRemoveItem) {
        setErrorMsg('Select an existing inventory item to remove.');
        return;
      }
      if (quantity > selectedRemoveItem.quantity) {
        setErrorMsg(
          `Cannot remove ${quantity} units — only ${selectedRemoveItem.quantity} ${selectedRemoveItem.unitOfMeasure} in warehouse stock.`,
        );
        return;
      }
      if (selectedCell && quantity > selectedCell.currentItems) {
        setErrorMsg(
          `Cell ${selectedCell.code} currently holds ${selectedCell.currentItems} unit(s). Pick another cell or lower the quantity.`,
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await warehouseApiService.adjustInventory(warehouse.id, {
        action,
        productId: isCreatingNewSku ? undefined : selectedProductId,
        newProduct:
          action === 'INSERT' && isCreatingNewSku
            ? {
                sku: newSku.trim().toUpperCase(),
                name: newName.trim(),
                category: newCategory.trim() || 'General Cargo',
                unitOfMeasure: newUnit.trim().toUpperCase() || 'PCS',
              }
            : undefined,
        quantity,
        row: selectedCell ? selectedCell.row : undefined,
        col: selectedCell ? selectedCell.col : undefined,
        partnerName: partnerName.trim() || undefined,
      });

      onSuccess(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Inventory update failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current && !isSubmitting && !isAnalyzingImage) {
      onClose();
    }
  };

  const handlePasteOrderImage = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (modalTab !== 'ORDER_SCAN' || isAnalyzingImage || isSubmitting) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      if (items[i].type.startsWith('image/')) {
        const pastedFile = items[i].getAsFile();
        if (pastedFile) {
          e.preventDefault();
          handleImageFileSelected(pastedFile);
          break;
        }
      }
    }
  };

  const pendingOrderLinesCount = orderLines.filter((l) => !l.applied).length;
  const totalOrderUnits = orderLines
    .filter((l) => !l.applied)
    .reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  return (
    <dialog
      ref={dialogRef}
      className={`wms-modal-dialog ${modalTab === 'ORDER_SCAN' ? 'wms-modal-wide' : ''}`}
      onCancel={(e) => {
        if (isSubmitting || isAnalyzingImage) {
          e.preventDefault();
          return;
        }
        onClose();
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="wms-modal-sheet corner-frame"
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePasteOrderImage}
      >
        <span className="corner top-left" />
        <span className="corner top-right" />
        <span className="corner bottom-left" />
        <span className="corner bottom-right" />

        {/* Modal Top Header */}
        <div className="wms-modal-head">
          <div>
            <h2>Manage warehouse stock</h2>
            <p className="wms-modal-sub">
              {warehouse.name} ({warehouse.code}) · {warehouse.matrixDimensionsText}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close inventory modal"
            onClick={onClose}
            disabled={isSubmitting || isAnalyzingImage}
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Segmented Switcher */}
        <div className="wms-modal-mode-bar">
          <div className="segmented-control modal-full-segments" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={modalTab === 'INSERT'}
              className={`segment-btn ${modalTab === 'INSERT' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('INSERT')}
              disabled={isSubmitting || isAnalyzingImage}
            >
              Insert item into cell
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modalTab === 'REMOVE'}
              className={`segment-btn ${modalTab === 'REMOVE' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('REMOVE')}
              disabled={isSubmitting || isAnalyzingImage}
            >
              Remove item from inventory
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modalTab === 'ORDER_SCAN'}
              className={`segment-btn segment-btn-ai ${modalTab === 'ORDER_SCAN' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('ORDER_SCAN')}
              disabled={isSubmitting || isAnalyzingImage}
            >
              <ScanLine size={14} />
              <span>Scan order document / image (AI)</span>
            </button>
          </div>
        </div>

        {isLoadingContext ? (
          <div className="state-notice">Loading catalog and storage matrix...</div>
        ) : modalTab === 'ORDER_SCAN' ? (
          /* ================================================================
             AI ORDER CONFIRMATION SCAN, REVIEW & EDITABLE CONFIRMATION VIEW
             ================================================================ */
          <div className="wms-modal-body">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
              className="sr-only-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                handleImageFileSelected(f);
                e.target.value = '';
              }}
            />

            {!orderAnalysis ? (
              <div className="order-upload-stage">
                <div
                  className={`order-dropzone ${isDraggingFile ? 'dragging' : ''} ${
                    isAnalyzingImage ? 'analyzing' : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!isAnalyzingImage) setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    if (isAnalyzingImage) return;
                    const dropped = e.dataTransfer.files?.[0];
                    handleImageFileSelected(dropped);
                  }}
                  onClick={() => {
                    if (!isAnalyzingImage) fileInputRef.current?.click();
                  }}
                >
                  {isAnalyzingImage ? (
                    <div className="order-analyzing-state">
                      {uploadedPreviewUrl && (
                        uploadedPreviewUrl.startsWith('data:application/pdf') ||
                        uploadedFileName?.toLowerCase().endsWith('.pdf') ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 88, height: 88, borderRadius: 10, background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: 13, border: '1px solid #fca5a5' }}>
                            <FileText size={38} />
                            <span style={{ marginTop: 4 }}>PDF</span>
                          </div>
                        ) : (
                          <img
                            src={uploadedPreviewUrl}
                            alt="Uploaded order confirmation preview"
                            className="order-preview-thumb-large"
                          />
                        )
                      )}
                      <div className="order-analyzing-copy">
                        <RefreshCw size={20} className="spin-icon" />
                        <strong>Analyzing order document ({uploadedFileName})...</strong>
                        <p>
                          Extracting direction (received vs. sent), supplier/customer, SKUs,
                          quantities, and optimal warehouse cells.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="order-dropzone-icon">
                        <Upload size={22} />
                      </div>
                      <div className="order-dropzone-title">
                        Upload or drop an order document (PDF or Image)
                      </div>
                      <p className="order-dropzone-sub">
                        Supports inbound supplier delivery receipts and outbound customer dispatch
                        confirmations (PDF, PNG, JPG, WEBP · or paste screenshot with Ctrl+V).
                      </p>
                      <span className="primary-action-btn order-browse-pill">
                        Choose document or image
                      </span>
                    </>
                  )}
                </div>

                {!isAnalyzingImage && (
                  <div className="order-sample-bar">
                    <span className="order-sample-label">Quick test with a sample slip:</span>
                    <div className="order-sample-actions">
                      <button
                        type="button"
                        className="secondary-action-btn sample-slip-btn"
                        onClick={() => handleGenerateSampleAndAnalyze('INBOUND')}
                      >
                        Sample: Inbound Supplier Receipt
                      </button>
                      <button
                        type="button"
                        className="secondary-action-btn sample-slip-btn"
                        onClick={() => handleGenerateSampleAndAnalyze('OUTBOUND')}
                      >
                        Sample: Outbound Customer Order
                      </button>
                    </div>
                  </div>
                )}

                {errorMsg && <div className="inline-error modal-error">{errorMsg}</div>}

                <div className="wms-modal-footer">
                  <button
                    type="button"
                    className="secondary-action-btn"
                    onClick={onClose}
                    disabled={isAnalyzingImage}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* STAGE B: HUMAN-IN-THE-LOOP REVIEW, EDIT & CONFIRM */
              <form onSubmit={handleConfirmOrderBatch} className="order-review-stage">
                {/* Summary Card with Image Thumbnail */}
                <div className="order-ai-summary-card">
                  {uploadedPreviewUrl && (
                    <div className="order-thumb-wrap">
                      {uploadedPreviewUrl.startsWith('data:application/pdf') ||
                      uploadedFileName?.toLowerCase().endsWith('.pdf') ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: 12, border: '1px solid #fca5a5' }}>
                          <FileText size={28} />
                          <span style={{ marginTop: 2 }}>PDF</span>
                        </div>
                      ) : (
                        <img
                          src={uploadedPreviewUrl}
                          alt={uploadedFileName || 'Order confirmation'}
                          className="order-summary-thumb"
                        />
                      )}
                      <button
                        type="button"
                        className="text-toggle-btn order-rescan-link"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSubmitting}
                      >
                        Upload another document
                      </button>
                    </div>
                  )}

                  <div className="order-summary-main">
                    <div className="order-summary-badges">
                      <span
                        className={`order-flow-pill ${
                          orderAction === 'INSERT' ? 'inbound' : 'outbound'
                        }`}
                      >
                        {orderAction === 'INSERT'
                          ? 'INBOUND · WE RECEIVED ITEMS'
                          : 'OUTBOUND · WE SENT ITEMS'}
                      </span>
                      <span className="order-engine-pill mono">
                        {orderAnalysis.provider === 'GEMINI_VISION'
                          ? 'Gemini 3.8 Vision'
                          : 'Local OCR Engine'}
                      </span>
                      {orderAnalysis.referenceCode && (
                        <span className="order-ref-pill mono">
                          #{orderAnalysis.referenceCode}
                        </span>
                      )}
                    </div>

                    <p className="order-summary-text">{orderAnalysis.summary}</p>

                    <div className="order-confirm-prompt">
                      <CheckCircle2 size={15} />
                      <span>
                        <strong>Please review &amp; confirm:</strong> Check the direction, partner,
                        items, quantities, and cells below. Edit anything that changed before
                        applying to warehouse stock.
                      </span>
                    </div>

                    {orderAnalysis.extractedTextPreview && (
                      <details className="order-ocr-details">
                        <summary>View extracted document text</summary>
                        <pre className="order-ocr-pre">{orderAnalysis.extractedTextPreview}</pre>
                      </details>
                    )}
                  </div>
                </div>

                {orderAnalysis.warnings.length > 0 && (
                  <div className="order-warnings-box">
                    {orderAnalysis.warnings.map((warn, wIdx) => (
                      <div key={`warn-${wIdx}`} className="order-warning-row">
                        <AlertTriangle size={14} />
                        <span>{warn}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Editable Order Direction & Counterparty */}
                <div className="modal-section order-header-controls">
                  <div className="field-row">
                    <label>Order direction (what happened?)</label>
                    <div className="segmented-control order-dir-segments">
                      <button
                        type="button"
                        className={`segment-btn ${orderAction === 'INSERT' ? 'active' : ''}`}
                        onClick={() => handleOrderDirectionSwitch('INSERT')}
                        disabled={isSubmitting}
                      >
                        We received items (Insert)
                      </button>
                      <button
                        type="button"
                        className={`segment-btn ${orderAction === 'REMOVE' ? 'active' : ''}`}
                        onClick={() => handleOrderDirectionSwitch('REMOVE')}
                        disabled={isSubmitting}
                      >
                        We sent items (Remove)
                      </button>
                    </div>
                  </div>

                  <div className="field-row">
                    <label htmlFor="order-partner-input">
                      {orderAction === 'INSERT'
                        ? 'Supplier & order reference'
                        : 'Recipient / customer & order reference'}
                    </label>
                    <input
                      id="order-partner-input"
                      type="text"
                      placeholder={
                        orderAction === 'INSERT'
                          ? 'e.g. Zebra EMEA Supply · PO-8842'
                          : 'e.g. Maya Retail Logistics · SO-5190'
                      }
                      value={orderPartner}
                      onChange={(e) => setOrderPartner(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {/* Editable Extracted Line Items */}
                <div className="modal-section order-lines-section">
                  <div className="modal-section-head">
                    <span className="modal-step-label">
                      Extracted order items ({orderLines.length})
                    </span>
                    <button
                      type="button"
                      className="text-toggle-btn order-add-line-btn"
                      onClick={handleAddOrderLine}
                      disabled={
                        isSubmitting || (orderAction === 'REMOVE' && inventoryItems.length === 0)
                      }
                    >
                      <Plus size={14} />
                      <span>Add item line</span>
                    </button>
                  </div>

                  {orderAction === 'REMOVE' && inventoryItems.length === 0 ? (
                    <div className="inline-error modal-error">
                      This warehouse currently has 0 items in stock to remove. Switch direction to
                      &ldquo;We received items (Insert)&rdquo; if this is an inbound delivery.
                    </div>
                  ) : (
                    <div className="order-lines-list">
                      {orderLines.map((line, idx) => {
                        const selectedLineLoc =
                          line.cellCoord && line.cellCoord !== 'NONE'
                            ? locations.find((c) => `${c.row}:${c.col}` === line.cellCoord) ?? null
                            : null;

                        return (
                          <div
                            key={line.id}
                            className={`order-line-card ${line.applied ? 'is-applied' : ''}`}
                          >
                            <div className="order-line-top">
                              <div className="order-line-title">
                                <span className="order-line-index mono">#{idx + 1}</span>
                                <span className="order-line-note">{line.confidenceNote}</span>
                                {line.applied && (
                                  <span className="order-applied-pill">Applied</span>
                                )}
                              </div>
                              {!line.applied && (
                                <button
                                  type="button"
                                  className="order-remove-line-btn"
                                  aria-label={`Remove line ${idx + 1}`}
                                  onClick={() => handleRemoveOrderLine(line.id)}
                                  disabled={isSubmitting}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>

                            <div className="order-line-grid">
                              {/* Item Selector */}
                              <div className="field-row">
                                <label>Item / SKU</label>
                                {orderAction === 'INSERT' ? (
                                  <select
                                    className="select-control"
                                    value={line.isNewSku ? '__NEW_SKU__' : line.productId}
                                    onChange={(e) =>
                                      handleOrderLineProductSelect(line.id, e.target.value)
                                    }
                                    disabled={isSubmitting || line.applied}
                                  >
                                    {catalog.map((prod) => {
                                      const held = inventoryByProductId.get(prod.id);
                                      return (
                                        <option key={prod.id} value={prod.id}>
                                          {prod.sku} — {prod.name} (
                                          {held ? `${held.quantity} in stock` : '0 in stock'})
                                        </option>
                                      );
                                    })}
                                    <option value="__NEW_SKU__">
                                      + Create new SKU ({line.sku || 'custom item'})
                                    </option>
                                  </select>
                                ) : (
                                  <select
                                    className="select-control"
                                    value={line.productId}
                                    onChange={(e) =>
                                      handleOrderLineProductSelect(line.id, e.target.value)
                                    }
                                    disabled={isSubmitting || line.applied}
                                  >
                                    {inventoryItems.map((inv) => (
                                      <option key={inv.id} value={inv.productId}>
                                        {inv.sku} — {inv.productName} ({inv.quantity}{' '}
                                        {inv.unitOfMeasure} available)
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>

                              {/* Quantity */}
                              <div className="field-row">
                                <label>Quantity</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={1000}
                                  className="tabular"
                                  value={line.quantity}
                                  onChange={(e) =>
                                    updateOrderLine(line.id, {
                                      quantity: Math.max(1, Number(e.target.value) || 1),
                                    })
                                  }
                                  disabled={isSubmitting || line.applied}
                                  required
                                />
                              </div>

                              {/* Cell Selector */}
                              <div className="field-row">
                                <label>
                                  {orderAction === 'INSERT' ? 'Target cell' : 'Pull from cell'}
                                </label>
                                <select
                                  className="select-control mono"
                                  value={line.cellCoord}
                                  onChange={(e) =>
                                    updateOrderLine(line.id, { cellCoord: e.target.value })
                                  }
                                  disabled={isSubmitting || line.applied}
                                >
                                  {orderAction === 'INSERT' && !line.cellCoord && (
                                    <option value="">-- Select cell --</option>
                                  )}
                                  {orderAction === 'REMOVE' && (
                                    <option value="NONE">
                                      Inventory ledger only (skip cell)
                                    </option>
                                  )}
                                  {locations.map((loc) => {
                                    const selectable = isCellSelectableForOrderLine(loc, line);
                                    return (
                                      <option
                                        key={loc.id}
                                        value={`${loc.row}:${loc.col}`}
                                        disabled={!selectable}
                                      >
                                        {loc.code} ({loc.currentItems}/{loc.maxUnits}
                                        {loc.product ? ` · ${loc.product.sku}` : ' · Open'})
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            </div>

                            {/* Extra fields when creating a brand-new catalog SKU */}
                            {orderAction === 'INSERT' && line.isNewSku && !line.applied && (
                              <div className="order-new-sku-subgrid">
                                <div className="field-row">
                                  <label>New SKU code</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. APX-TAG-990"
                                    value={line.sku}
                                    onChange={(e) =>
                                      updateOrderLine(line.id, { sku: e.target.value })
                                    }
                                    required
                                  />
                                </div>
                                <div className="field-row">
                                  <label>New product name</label>
                                  <input
                                    type="text"
                                    placeholder="Product description"
                                    value={line.productName}
                                    onChange={(e) =>
                                      updateOrderLine(line.id, { productName: e.target.value })
                                    }
                                    required
                                  />
                                </div>
                                <div className="field-row">
                                  <label>Unit</label>
                                  <select
                                    className="select-control"
                                    value={line.unitOfMeasure}
                                    onChange={(e) =>
                                      updateOrderLine(line.id, { unitOfMeasure: e.target.value })
                                    }
                                  >
                                    <option value="PCS">PCS</option>
                                    <option value="BOX">BOX</option>
                                    <option value="CASE">CASE</option>
                                    <option value="PALLET">PALLET</option>
                                    <option value="CRATE">CRATE</option>
                                    <option value="ROLL">ROLL</option>
                                    <option value="SET">SET</option>
                                  </select>
                                </div>
                                <div className="field-row">
                                  <label>Category</label>
                                  <input
                                    type="text"
                                    value={line.category}
                                    onChange={(e) =>
                                      updateOrderLine(line.id, { category: e.target.value })
                                    }
                                  />
                                </div>
                              </div>
                            )}

                            {selectedLineLoc && (
                              <div className="order-line-impact mono">
                                Cell {selectedLineLoc.code}: {selectedLineLoc.currentItems} →{' '}
                                <strong>
                                  {orderAction === 'INSERT'
                                    ? Math.min(
                                        selectedLineLoc.maxUnits,
                                        selectedLineLoc.currentItems + (line.quantity || 0),
                                      )
                                    : Math.max(
                                        0,
                                        selectedLineLoc.currentItems - (line.quantity || 0),
                                      )}
                                </strong>{' '}
                                / {selectedLineLoc.maxUnits} units
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {errorMsg && <div className="inline-error modal-error">{errorMsg}</div>}

                <div className="wms-modal-footer order-review-footer">
                  <button
                    type="button"
                    className="secondary-action-btn"
                    onClick={() => {
                      setOrderAnalysis(null);
                      setOrderLines([]);
                      setErrorMsg(null);
                    }}
                    disabled={isSubmitting}
                  >
                    Scan different image
                  </button>
                  <div className="order-footer-right">
                    <button
                      type="button"
                      className="secondary-action-btn"
                      onClick={onClose}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className={`primary-action-btn ${
                        orderAction === 'REMOVE' ? 'danger-tone' : ''
                      }`}
                      disabled={
                        isSubmitting ||
                        pendingOrderLinesCount === 0 ||
                        (orderAction === 'REMOVE' && inventoryItems.length === 0)
                      }
                    >
                      {isSubmitting
                        ? 'Applying order...'
                        : orderAction === 'INSERT'
                          ? `Confirm & Insert ${pendingOrderLinesCount} item(s) (${totalOrderUnits} units)`
                          : `Confirm & Remove ${pendingOrderLinesCount} item(s) (${totalOrderUnits} units)`}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        ) : action === 'REMOVE' && inventoryItems.length === 0 ? (
          <div className="wms-modal-empty">
            <p>There are currently no items in {warehouse.name} to remove.</p>
            <div className="empty-modal-cta-row">
              <button
                type="button"
                className="primary-action-btn"
                onClick={() => handleModeSwitch('INSERT')}
              >
                Switch to insert item
              </button>
              <button
                type="button"
                className="secondary-action-btn"
                onClick={() => handleModeSwitch('ORDER_SCAN')}
              >
                Scan order image (AI)
              </button>
            </div>
          </div>
        ) : (
          /* ================================================================
             MANUAL SINGLE-ITEM INSERT / REMOVE FORM
             ================================================================ */
          <form onSubmit={handleSubmit} className="wms-modal-body">
            {/* STEP 1: ITEM SELECTION */}
            <div className="modal-section">
              <div className="modal-section-head">
                <span className="modal-step-label">1. Select item</span>
                <div className="modal-step-actions">
                  <button
                    type="button"
                    className="text-toggle-btn scan-shortcut-btn"
                    onClick={() => handleModeSwitch('ORDER_SCAN')}
                  >
                    <ScanLine size={13} />
                    <span>Upload order image (AI)</span>
                  </button>
                  {action === 'INSERT' && (
                    <button
                      type="button"
                      className="text-toggle-btn"
                      onClick={() => {
                        setIsCreatingNewSku((prev) => !prev);
                        setErrorMsg(null);
                      }}
                    >
                      {isCreatingNewSku ? 'Use existing catalog SKU' : '+ Create new SKU'}
                    </button>
                  )}
                </div>
              </div>

              {action === 'INSERT' && isCreatingNewSku ? (
                <div className="new-sku-grid">
                  <div className="field-row">
                    <label htmlFor="new-sku-input">SKU code</label>
                    <input
                      id="new-sku-input"
                      type="text"
                      placeholder="e.g. APX-PAL-900"
                      value={newSku}
                      onChange={(e) => setNewSku(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="new-unit-select">Unit of measure</label>
                    <select
                      id="new-unit-select"
                      className="select-control"
                      value={newUnit}
                      onChange={(e) => setNewUnit(e.target.value)}
                    >
                      <option value="PCS">PCS</option>
                      <option value="BOX">BOX</option>
                      <option value="CASE">CASE</option>
                      <option value="PALLET">PALLET</option>
                      <option value="CRATE">CRATE</option>
                      <option value="ROLL">ROLL</option>
                      <option value="SET">SET</option>
                    </select>
                  </div>
                  <div className="field-row">
                    <label htmlFor="new-name-input">Product name</label>
                    <input
                      id="new-name-input"
                      type="text"
                      placeholder="e.g. Heavy-Duty Euro Pallet Sensor"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="field-row">
                    <label htmlFor="new-cat-input">Category</label>
                    <input
                      id="new-cat-input"
                      type="text"
                      placeholder="e.g. Warehouse Hardware"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      required
                    />
                  </div>
                </div>
              ) : action === 'INSERT' ? (
                <div className="field-row">
                  <label htmlFor="insert-product-select">Catalog product</label>
                  <select
                    id="insert-product-select"
                    className="select-control modal-select-full"
                    value={selectedProductId}
                    onChange={(e) => handleProductChange(e.target.value)}
                  >
                    {catalog.map((prod) => {
                      const held = inventoryByProductId.get(prod.id);
                      return (
                        <option key={prod.id} value={prod.id}>
                          {prod.sku} — {prod.name} (
                          {held
                            ? `${held.quantity} ${prod.unitOfMeasure} in warehouse`
                            : '0 in warehouse'}
                          )
                        </option>
                      );
                    })}
                  </select>
                </div>
              ) : (
                <div className="field-row">
                  <label htmlFor="remove-product-select">Warehouse stock item</label>
                  <select
                    id="remove-product-select"
                    className="select-control modal-select-full"
                    value={selectedProductId}
                    onChange={(e) => handleProductChange(e.target.value)}
                  >
                    {inventoryItems.map((item) => (
                      <option key={item.id} value={item.productId}>
                        {item.sku} — {item.productName} ({item.quantity} {item.unitOfMeasure}{' '}
                        available)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* STEP 2: STORAGE CELL [ROW, COL] */}
            <div className="modal-section">
              <div className="modal-section-head">
                <span className="modal-step-label">
                  {action === 'INSERT'
                    ? '2. Choose target storage cell'
                    : '2. Choose cell to pull from'}
                </span>
                <select
                  aria-label="Storage cell selector"
                  className="select-control mono"
                  value={selectedCellCoord}
                  onChange={(e) => setSelectedCellCoord(e.target.value)}
                >
                  {action === 'REMOVE' && (
                    <option value="NONE">Inventory ledger only (skip cell counter)</option>
                  )}
                  {locations.map((loc) => {
                    const isDisabled = !isCellValidForSelection(loc);
                    return (
                      <option
                        key={loc.id}
                        value={`${loc.row}:${loc.col}`}
                        disabled={isDisabled}
                      >
                        {loc.code} [{loc.row},{loc.col}] — {loc.currentItems}/{loc.maxUnits}
                        {loc.product ? ` (${loc.product.sku})` : ' (Open)'}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Compact Visual 2D Matrix Picker */}
              <div className="modal-matrix-picker">
                <div
                  className="warehouse-2d-matrix modal-compact-grid"
                  style={{
                    gridTemplateColumns: `24px repeat(${warehouse.cols}, minmax(22px, 1fr))`,
                  }}
                >
                  <div className="matrix-corner-label" />
                  {Array.from({ length: warehouse.cols }, (_, cIdx) => (
                    <div key={`mcol-${cIdx}`} className="matrix-col-header">
                      {String(cIdx + 1).padStart(2, '0')}
                    </div>
                  ))}

                  {matrixRows.map((rowCells, rIdx) => (
                    <React.Fragment key={`mrow-${rIdx}`}>
                      <div className="matrix-row-header">{String.fromCharCode(65 + rIdx)}</div>
                      {rowCells.map((cell) => {
                        if (!cell) return null;
                        const coord = `${cell.row}:${cell.col}`;
                        const isSelected = selectedCellCoord === coord;
                        const isSelectable = isCellValidForSelection(cell);

                        return (
                          <button
                            key={cell.id}
                            type="button"
                            disabled={!isSelectable}
                            onClick={() => setSelectedCellCoord(coord)}
                            className={`matrix-cell-btn modal-cell ${
                              cell.isOccupied ? 'occupied' : 'open'
                            } ${isSelected ? 'selected' : ''}`}
                            title={`${cell.code}: ${cell.currentItems}/${cell.maxUnits}${
                              cell.product
                                ? ` · ${cell.product.sku} (${cell.product.productName})`
                                : ' · Open cell'
                            }`}
                          >
                            {cell.currentItems}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {selectedCell && (
                <div className="cell-impact-preview tabular">
                  <span>
                    Selected cell <strong>{selectedCell.code}</strong> [{selectedCell.row},{' '}
                    {selectedCell.col}]
                  </span>
                  <span className="mono">
                    {selectedCell.currentItems} →{' '}
                    <strong>
                      {action === 'INSERT'
                        ? Math.min(
                            selectedCell.maxUnits,
                            selectedCell.currentItems + (quantity || 0),
                          )
                        : Math.max(0, selectedCell.currentItems - (quantity || 0))}
                    </strong>{' '}
                    / {selectedCell.maxUnits} items
                  </span>
                </div>
              )}
            </div>

            {/* STEP 3: QUANTITY & PARTNER */}
            <div className="modal-section modal-bottom-grid">
              <div className="field-row">
                <label htmlFor="modal-qty-input">
                  Quantity ({maxAllowedQuantity} max for selection)
                </label>
                <div className="qty-input-cluster">
                  <input
                    id="modal-qty-input"
                    type="number"
                    min={1}
                    max={Math.max(1, maxAllowedQuantity)}
                    className="tabular"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    required
                  />
                  <div className="qty-presets">
                    {[1, 5, 10, 25].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className="counter-step-btn"
                        disabled={maxAllowedQuantity > 0 && preset > maxAllowedQuantity}
                        onClick={() => setQuantity(preset)}
                      >
                        {preset}
                      </button>
                    ))}
                    {action === 'REMOVE' && maxAllowedQuantity > 0 && (
                      <button
                        type="button"
                        className="counter-step-btn"
                        onClick={() => setQuantity(maxAllowedQuantity)}
                      >
                        Max ({maxAllowedQuantity})
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="field-row">
                <label htmlFor="modal-partner-input">
                  {action === 'INSERT'
                    ? 'Supplier / source (optional)'
                    : 'Destination / note (optional)'}
                </label>
                <input
                  id="modal-partner-input"
                  type="text"
                  placeholder={
                    action === 'INSERT' ? 'e.g. Zebra EMEA Supply' : 'e.g. Order pick #508'
                  }
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                />
              </div>
            </div>

            {errorMsg && <div className="inline-error modal-error">{errorMsg}</div>}

            <div className="wms-modal-footer">
              <button
                type="button"
                className="secondary-action-btn"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`primary-action-btn ${action === 'REMOVE' ? 'danger-tone' : ''}`}
                disabled={isSubmitting || maxAllowedQuantity <= 0}
              >
                {isSubmitting
                  ? 'Saving...'
                  : action === 'INSERT'
                    ? `Insert ${quantity} into ${selectedCell?.code ?? 'cell'}`
                    : `Remove ${quantity} from inventory`}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
};
