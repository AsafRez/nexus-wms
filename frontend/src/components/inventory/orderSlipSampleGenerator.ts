import {
  ProductCatalogItemDto,
  WarehouseInventoryItemDto,
} from '../../../../shared/wms.contracts';

export interface SampleOrderImageResult {
  dataUrl: string;
  mimeType: 'image/png';
  fileName: string;
}

/**
 * Renders a crisp, high-contrast order confirmation slip onto an HTML5 canvas
 * using real SKUs from the active warehouse so operators can test the live
 * OCR / Gemini Vision pipeline in one click when no local image is handy.
 */
export function generateSampleOrderSlipPng(
  kind: 'INBOUND' | 'OUTBOUND',
  warehouseName: string,
  warehouseCode: string,
  catalog: ProductCatalogItemDto[],
  inventoryItems: WarehouseInventoryItemDto[],
): SampleOrderImageResult {
  const canvas = document.createElement('canvas');
  canvas.width = 920;
  canvas.height = 560;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available in this browser.');
  }

  // Crisp white paper background with subtle industrial border
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#1E242B';
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

  // Header band
  ctx.fillStyle = '#16191D';
  ctx.fillRect(36, 36, canvas.width - 72, 74);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 26px Arial, sans-serif';
  const title =
    kind === 'INBOUND'
      ? 'INBOUND DELIVERY RECEIPT'
      : 'OUTBOUND DISPATCH CONFIRMATION';
  ctx.fillText(title, 56, 82);

  // Document metadata lines (clear labels for OCR & Vision)
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 20px Arial, sans-serif';

  const refCode = kind === 'INBOUND' ? 'PO-8842' : 'SO-5190';
  const partnerLine =
    kind === 'INBOUND'
      ? 'Supplier: Zebra EMEA Supply'
      : 'Ship To: Maya Retail Logistics';
  const facilityLine = `Facility: ${warehouseName} (${warehouseCode})`;

  ctx.fillText(`Order #: ${refCode}`, 56, 152);
  ctx.fillText(partnerLine, 56, 188);
  ctx.font = '18px Arial, sans-serif';
  ctx.fillText(facilityLine, 56, 222);

  // Divider
  ctx.strokeStyle = '#8A94A0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(56, 248);
  ctx.lineTo(canvas.width - 56, 248);
  ctx.stroke();

  ctx.fillStyle = '#111111';
  ctx.font = 'bold 19px Arial, sans-serif';
  ctx.fillText('ORDER LINE ITEMS', 56, 282);

  // Build realistic lines grounded in the active warehouse's items
  const lines: string[] = [];
  if (kind === 'INBOUND') {
    const first = catalog[0];
    const second = catalog[1];
    if (first) {
      lines.push(`${first.sku}  ${first.name}  Qty: 8 ${first.unitOfMeasure}`);
    } else {
      lines.push('APX-SCN-400  Industrial Barcode Scanner  Qty: 8 PCS');
    }
    if (second) {
      lines.push(`${second.sku}  ${second.name}  Qty: 12 ${second.unitOfMeasure}`);
    } else {
      lines.push('APX-TAG-990  Smart UWB Pallet Beacon  Qty: 10 PCS');
    }
  } else {
    const firstStock = inventoryItems.find((item) => item.quantity >= 2) ?? inventoryItems[0];
    const secondStock = inventoryItems.find(
      (item) => item.productId !== firstStock?.productId && item.quantity >= 1,
    );
    if (firstStock) {
      const sendQty = Math.max(1, Math.min(4, firstStock.quantity));
      lines.push(
        `${firstStock.sku}  ${firstStock.productName}  Qty: ${sendQty} ${firstStock.unitOfMeasure}`,
      );
    } else {
      lines.push('APX-SCN-400  Industrial Barcode Scanner  Qty: 3 PCS');
    }
    if (secondStock) {
      const sendQty2 = Math.max(1, Math.min(3, secondStock.quantity));
      lines.push(
        `${secondStock.sku}  ${secondStock.productName}  Qty: ${sendQty2} ${secondStock.unitOfMeasure}`,
      );
    }
  }

  ctx.font = 'bold 21px Consolas, monospace';
  lines.forEach((line, idx) => {
    const y = 330 + idx * 52;
    ctx.fillStyle = '#F4F6F8';
    ctx.fillRect(56, y - 30, canvas.width - 112, 42);
    ctx.fillStyle = '#111111';
    ctx.fillText(line, 70, y - 2);
  });

  // Footer status line
  ctx.font = '18px Arial, sans-serif';
  ctx.fillStyle = '#2B333C';
  ctx.fillText(
    kind === 'INBOUND'
      ? 'Status: Goods Received at Dock - Pending Putaway Confirmation'
      : 'Status: Packed & Dispatched to Customer - Pending Stock Deduction',
    56,
    495,
  );

  return {
    dataUrl: canvas.toDataURL('image/png'),
    mimeType: 'image/png',
    fileName:
      kind === 'INBOUND'
        ? `inbound-${refCode.toLowerCase()}.png`
        : `outbound-${refCode.toLowerCase()}.png`,
  };
}

