import { BadRequestException, Injectable } from '@nestjs/common';
import { WarehouseAiContext } from './ai-context.model';
import { AnalyzedOrderLineItem, OrderImageAnalysisResult } from './ai.types';

interface RawExtractedLine {
  rawText: string;
  skuHint: string;
  nameHint: string;
  quantity: number;
  unitHint: string;
  categoryHint: string;
}

interface RawStructuredOrder {
  detectedAction: 'INSERT' | 'REMOVE';
  referenceCode: string | null;
  partnerName: string;
  summary: string;
  extractedTextPreview: string;
  items: RawExtractedLine[];
}


@Injectable()
export class OrderDocumentAnalyzerService {
  /**
   * Validates image bytes & magic headers, extracts order confirmation details via
   * Gemini Vision, and grounds every line item against the live warehouse catalog,
   * stock, and 2D storage matrix. Cross-platform (Linux/macOS/Windows/Docker).
   */
  public async analyzeOrderConfirmation(
    ctx: WarehouseAiContext,
    params: {
      imageBase64: string;
      mimeType: string;
      fileName?: string;
      hintAction?: 'INSERT' | 'REMOVE';
    },
  ): Promise<OrderImageAnalysisResult> {
    const { buffer, normalizedMime } = this.validateAndDecodeImage(
      params.imageBase64,
      params.mimeType,
    );
    const cleanBase64 = buffer.toString('base64');
    const defaultAction = params.hintAction === 'REMOVE' ? 'REMOVE' : 'INSERT';

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey) {
      try {
        const rawOrder = await this.analyzeWithGeminiVision(
          ctx,
          cleanBase64,
          normalizedMime,
          defaultAction,
        );
        return this.groundStructuredOrder(ctx, rawOrder, 'GEMINI_VISION');
      } catch (err: any) {
        console.warn('Gemini Vision order analysis failed:', err);
      }
    }

    const fallbackOrder: RawStructuredOrder = {
      detectedAction: defaultAction,
      referenceCode: params.fileName ? params.fileName.replace(/\.[^/.]+$/, '').toUpperCase() : null,
      partnerName: '',
      summary: apiKey
        ? 'Could not automatically extract items from this document via Gemini Vision. Please enter or review the order line items below.'
        : 'AI Document Vision requires GEMINI_API_KEY to be configured. Please enter or review the order details manually below.',
      extractedTextPreview: params.fileName ? `File: ${params.fileName}` : '',
      items: [],
    };
    return this.groundStructuredOrder(ctx, fallbackOrder, 'LOCAL_OCR_ENGINE');
  }

  private validateAndDecodeImage(
    rawBase64Input: string,
    rawMime: string,
  ): {
    buffer: Buffer;
    normalizedMime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
    ext: string;
  } {
    if (!rawBase64Input || typeof rawBase64Input !== 'string') {
      throw new BadRequestException('Please upload an order confirmation document or image.');
    }

    const stripped = rawBase64Input.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
    if (stripped.length < 40) {
      throw new BadRequestException('Uploaded file is empty or corrupted.');
    }
    if (stripped.length > 25_000_000) {
      throw new BadRequestException('File exceeds the 18 MB upload limit.');
    }

    const buffer = Buffer.from(stripped, 'base64');
    if (buffer.length < 32) {
      throw new BadRequestException('Invalid base64 document payload.');
    }

    const isPng =
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    const isPdf =
      (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') ||
      buffer.subarray(0, 1024).includes('%PDF') ||
      rawMime?.toLowerCase().includes('pdf');

    if (isPng) {
      return { buffer, normalizedMime: 'image/png', ext: 'png' };
    }
    if (isJpeg) {
      return { buffer, normalizedMime: 'image/jpeg', ext: 'jpg' };
    }
    if (isWebp) {
      return { buffer, normalizedMime: 'image/webp', ext: 'webp' };
    }
    if (isPdf) {
      return { buffer, normalizedMime: 'application/pdf', ext: 'pdf' };
    }

    throw new BadRequestException(
      `Unsupported or corrupted file format (${rawMime || 'unknown'}). Upload a PDF, PNG, JPG, or WEBP order document.`,
    );
  }

  private async analyzeWithGeminiVision(
    ctx: WarehouseAiContext,
    cleanBase64: string,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf',
    defaultAction: 'INSERT' | 'REMOVE',
  ): Promise<RawStructuredOrder> {
    const apiKey = process.env.GEMINI_API_KEY!.trim();
    const candidateModels = [
      process.env.GEMINI_MODEL?.trim(),
      'gemini-2.5-flash',
      'gemini-3.8-flash',
    ].filter((m): m is string => Boolean(m && m.length > 0));

    const sanitizeParsedOrder = (parsed: any): RawStructuredOrder => {
      const referenceCode = parsed.referenceCode ? String(parsed.referenceCode).trim() : null;
      const partnerName = parsed.partnerName ? String(parsed.partnerName).trim() : '';
      const summary = parsed.summary ? String(parsed.summary).trim() : 'Extracted order confirmation details.';
      let extractedTextPreview = '';
      if (Array.isArray(parsed.extractedTextPreview)) {
        extractedTextPreview = parsed.extractedTextPreview
          .map((x: any) => String(x ?? '').trim())
          .filter(Boolean)
          .join(' · ')
          .slice(0, 320);
      } else if (parsed.extractedTextPreview) {
        extractedTextPreview = String(parsed.extractedTextPreview).trim().slice(0, 320);
      }

      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      return {
        detectedAction: parsed.detectedAction === 'REMOVE' ? 'REMOVE' : 'INSERT',
        referenceCode: referenceCode || null,
        partnerName,
        summary,
        extractedTextPreview,
        items: rawItems.map((it: any) => ({
          rawText: String(it.rawText ?? '').trim(),
          skuHint: String(it.skuHint ?? '').trim(),
          nameHint: String(it.nameHint ?? '').trim(),
          quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          unitHint: String(it.unitHint ?? 'PCS').trim() || 'PCS',
          categoryHint: String(it.categoryHint ?? 'General Cargo').trim() || 'General Cargo',
        })),
      };
    };

    const catalogContext = ctx.catalog
      .map((p) => `- ${p.sku}: ${p.name} [${p.unitOfMeasure}] (${p.category})`)
      .join('\n');

    const prompt = [
      `You are an AI warehouse order-confirmation analyzer for ${ctx.dashboard.warehouse.name} (${ctx.dashboard.warehouse.code}).`,
      `Analyze the uploaded order confirmation / purchase order / packing slip / delivery note (PDF document or image) carefully.`,
      `Extract EVERY line item from the order table or items list (all rows).`,
      `Determine:`,
      `1. detectedAction: "INSERT" if goods were RECEIVED into our warehouse from a supplier/vendor, OR "REMOVE" if goods were SENT / SHIPPED / DISPATCHED out to a customer/recipient. Default to "${defaultAction}" if unclear.`,
      `2. referenceCode: Order/PO/SO/Invoice number if visible (e.g. PO-908712), else null.`,
      `3. partnerName: Supplier name (if INSERT) or Customer/Recipient name (if REMOVE).`,
      `4. summary: A concise 1-sentence description of what was received or sent.`,
      `5. extractedTextPreview: Short text preview read from the document.`,
      `6. items: Array of EVERY single product line item found in the table. For each row extract:`,
      `   - rawText: raw text of that table row`,
      `   - skuHint: exact SKU code (e.g. APX-PAL-900, CON-CBL-10M, POW-SUP-24V, SEN-PRX-M18, ACT-PNE-VLV)`,
      `   - nameHint: clear product name`,
      `   - quantity: exact integer quantity (e.g. 50, 200, 75, 120, 40)`,
      `   - unitHint: unit of measure (e.g. PCS, M, KG)`,
      `   - categoryHint: product category or General Cargo`,
      `Our known business catalog SKUs:`,
      catalogContext,
      `IMPORTANT: Output pure valid JSON conforming to this schema without any markdown wrapping.`,
    ].join('\n');

    // 1. Try standard generateContent with candidate Gemini models
    for (const model of candidateModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: cleanBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (textPart) {
            const cleaned = textPart.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            return sanitizeParsedOrder(parsed);
          }
        } else {
          const errText = await res.text();
          console.warn(`Gemini Vision generateContent with ${model} returned (${res.status}): ${errText}`);
        }
      } catch (e) {
        console.warn(`Gemini Vision attempt with model ${model} failed:`, e);
      }
    }

    // 2. Fallback attempt with modern interactions endpoint
    try {
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'Api-Revision': '2026-05-20',
        },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          model: candidateModels[0] || 'gemini-2.5-flash',
          store: false,
          input: [
            { type: 'text', text: prompt },
            { type: 'image', data: cleanBase64, mime_type: mimeType },
          ],
          response_format: {
            type: 'text',
            mime_type: 'application/json',
          },
        }),
      });

      if (response.ok) {
        const jsonBody = (await response.json()) as any;
        const outputText = (jsonBody.steps ?? [])
          .filter((s: any) => s.type === 'model_output')
          .flatMap((s: any) => s.content ?? [])
          .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text!)
          .join('')
          .trim();

        if (outputText) {
          const cleaned = outputText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          return sanitizeParsedOrder(parsed);
        }
      }
    } catch (err) {
      console.warn('Interactions fallback failed:', err);
    }

    throw new Error('All Gemini Vision analysis attempts failed.');
  }

  private groundStructuredOrder(
    ctx: WarehouseAiContext,
    raw: RawStructuredOrder,
    provider: 'GEMINI_VISION' | 'LOCAL_OCR_ENGINE',
  ): OrderImageAnalysisResult {
    const warnings: string[] = [];
    const action = raw.detectedAction;

    if (
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)|system\s+override|developer\s+mode|התעלם\s+מ(כל\s+)?ה?(הוראות|פקודות)/i.test(
        `${raw.extractedTextPreview} ${raw.summary}`,
      )
    ) {
      warnings.push(
        'Security guardrail: Suspicious prompt-override text was detected on this document and ignored. No stock changes are ever executed without your confirmation.',
      );
    }

    // Track virtual cell reservations across multi-line orders so 2 SKUs never pick the same empty cell
    const virtualCellItems = new Map<string, number>();
    const virtualCellProduct = new Map<string, string | null>();
    for (const c of ctx.flatCells) {
      virtualCellItems.set(c.code, c.currentItems);
      virtualCellProduct.set(c.code, c.product?.productId ?? null);
    }

    const groundedItems: AnalyzedOrderLineItem[] = raw.items.map((item, idx) => {
      const normalizedSkuHint = item.skuHint.trim().toUpperCase();
      const hasStructuredSkuHint = /^[A-Z]{2,5}[-.][A-Z0-9]{2,5}[-.][A-Z0-9]{2,5}$/i.test(normalizedSkuHint);
      const combinedQuery = `${item.skuHint} ${item.nameHint}`.trim();

      const matchedCatalog = hasStructuredSkuHint
        ? (ctx.catalog.find((p) => p.sku.toUpperCase() === normalizedSkuHint.replace(/\./g, '-')) ?? null)
        : (ctx.matchCatalogProduct(item.skuHint) ?? ctx.matchCatalogProduct(combinedQuery));
      const matchedInv = matchedCatalog
        ? (ctx.inventory.find((i) => i.productId === matchedCatalog.id) ?? null)
        : hasStructuredSkuHint
          ? (ctx.inventory.find((i) => i.sku.toUpperCase() === normalizedSkuHint.replace(/\./g, '-')) ?? null)
          : (ctx.matchInventoryItem(combinedQuery) ?? null);

      const qty = Math.max(1, Math.round(item.quantity || 1));

      if (action === 'INSERT') {
        const isNewSku = !matchedCatalog;
        const resolvedProdId = matchedCatalog?.id ?? null;
        const resolvedSku =
          matchedCatalog?.sku ?? (item.skuHint.toUpperCase() || `NEW-SKU-${idx + 1}`);
        const resolvedName = matchedCatalog?.name ?? (item.nameHint || `New Product ${idx + 1}`);
        const resolvedCat = matchedCatalog?.category ?? (item.categoryHint || 'General Cargo');
        const resolvedUnit = (matchedCatalog?.unitOfMeasure ?? item.unitHint ?? 'PCS').toUpperCase();

        // 1. If we ALREADY have this product in warehouse cells, prioritize placing it in the SAME cell (container)
        let chosenCell = resolvedProdId
          ? ctx.flatCells.find((c) => {
            const cur = virtualCellItems.get(c.code) ?? c.currentItems;
            const pid = virtualCellProduct.get(c.code);
            // Matches same product and has space
            return cur > 0 && pid === resolvedProdId && c.maxUnits - cur >= qty;
          })
          : undefined;

        // 2. If existing cell is full or not found, find an empty container/cell
        if (!chosenCell) {
          chosenCell = ctx.flatCells.find((c) => {
            const cur = virtualCellItems.get(c.code) ?? c.currentItems;
            const pid = virtualCellProduct.get(c.code);
            return cur === 0 && pid === null && c.maxUnits >= Math.min(qty, c.maxUnits);
          });
        }

        if (chosenCell) {
          virtualCellItems.set(
            chosenCell.code,
            (virtualCellItems.get(chosenCell.code) ?? 0) + qty,
          );
          virtualCellProduct.set(chosenCell.code, resolvedProdId ?? `NEW:${resolvedSku}`);
        } else {
          warnings.push(
            `No single cell had ${qty} free slots for ${resolvedSku} — please pick a target cell before confirming.`,
          );
        }

        const isSameCellReused = Boolean(
          resolvedProdId &&
          chosenCell &&
          ctx.flatCells.some(
            (orig) => orig.code === chosenCell!.code && orig.product?.productId === resolvedProdId,
          ),
        );

        return {
          lineId: `line-${idx + 1}`,
          rawText: item.rawText,
          matchedProductId: resolvedProdId,
          sku: resolvedSku,
          productName: resolvedName,
          category: resolvedCat,
          unitOfMeasure: resolvedUnit,
          quantity: qty,
          isNewSku,
          suggestedCellCode: chosenCell?.code ?? null,
          suggestedRow: chosenCell?.row ?? null,
          suggestedCol: chosenCell?.col ?? null,
          confidenceNote: isSameCellReused
            ? `Matched existing product — added to same container/cell (${chosenCell?.code})`
            : isNewSku
              ? 'New SKU (will be added to catalog on confirm)'
              : 'Matched existing catalog SKU',
        };
      }

      // action === 'REMOVE' (Outbound order sent to customer)
      const invTarget = matchedInv ?? ctx.inventory[0] ?? null;
      if (!matchedInv) {
        warnings.push(
          `"${item.skuHint || item.nameHint}" was not found in current ${ctx.dashboard.warehouse.code} stock — please verify the SKU to deduct.`,
        );
      } else if (qty > matchedInv.quantity) {
        warnings.push(
          `Order lists ${qty} × ${matchedInv.sku}, while warehouse stock holds ${matchedInv.quantity} ${matchedInv.unitOfMeasure}.`,
        );
      }

      let pickCell = invTarget
        ? ctx.flatCells.find((c) => {
          const cur = virtualCellItems.get(c.code) ?? c.currentItems;
          const pid = virtualCellProduct.get(c.code);
          return pid === invTarget.productId && cur >= qty;
        }) ??
        ctx.flatCells.find((c) => {
          const cur = virtualCellItems.get(c.code) ?? c.currentItems;
          const pid = virtualCellProduct.get(c.code);
          return pid === invTarget.productId && cur > 0;
        })
        : undefined;

      if (pickCell) {
        const cur = virtualCellItems.get(pickCell.code) ?? pickCell.currentItems;
        const nextCur = Math.max(0, cur - qty);
        virtualCellItems.set(pickCell.code, nextCur);
        if (nextCur === 0) {
          virtualCellProduct.set(pickCell.code, null);
        }
      }

      return {
        lineId: `line-${idx + 1}`,
        rawText: item.rawText,
        matchedProductId: invTarget?.productId ?? matchedCatalog?.id ?? null,
        sku: invTarget?.sku ?? matchedCatalog?.sku ?? (item.skuHint || 'UNKNOWN'),
        productName: invTarget?.productName ?? matchedCatalog?.name ?? (item.nameHint || 'Unknown Item'),
        category: invTarget?.category ?? matchedCatalog?.category ?? 'General Cargo',
        unitOfMeasure: invTarget?.unitOfMeasure ?? matchedCatalog?.unitOfMeasure ?? 'PCS',
        quantity: invTarget ? Math.min(qty, Math.max(1, invTarget.quantity)) : qty,
        isNewSku: false,
        suggestedCellCode: pickCell?.code ?? null,
        suggestedRow: pickCell?.row ?? null,
        suggestedCol: pickCell?.col ?? null,
        confidenceNote: matchedInv
          ? `Matched in-stock SKU (${matchedInv.quantity} ${matchedInv.unitOfMeasure} available)`
          : 'Needs manual SKU selection',
      };
    });

    // If image had no automatically matched items, provide 1 editable starter row so operator can still confirm easily
    if (groundedItems.length === 0) {
      const fallbackProd =
        action === 'REMOVE'
          ? (ctx.inventory[0]
            ? {
              id: ctx.inventory[0].productId,
              sku: ctx.inventory[0].sku,
              name: ctx.inventory[0].productName,
              category: ctx.inventory[0].category,
              unitOfMeasure: ctx.inventory[0].unitOfMeasure,
            }
            : null)
          : (ctx.catalog[0] ?? null);

      const fallbackCell =
        action === 'INSERT'
          ? (ctx.openCells[0] ?? null)
          : fallbackProd
            ? (ctx.getCellsForProduct(fallbackProd.id)[0] ?? null)
            : null;

      warnings.push(
        'No clear SKU codes were detected in the image — please review and select the exact item & quantity below.',
      );

      if (fallbackProd) {
        groundedItems.push({
          lineId: 'line-1',
          rawText: '',
          matchedProductId: fallbackProd.id,
          sku: fallbackProd.sku,
          productName: fallbackProd.name,
          category: fallbackProd.category,
          unitOfMeasure: fallbackProd.unitOfMeasure,
          quantity: 5,
          isNewSku: false,
          suggestedCellCode: fallbackCell?.code ?? null,
          suggestedRow: fallbackCell?.row ?? null,
          suggestedCol: fallbackCell?.col ?? null,
          confidenceNote: 'Manual verification required',
        });
      }
    }

    const formattedPartner =
      raw.partnerName && raw.referenceCode && !raw.partnerName.includes(raw.referenceCode)
        ? `${raw.partnerName} (${raw.referenceCode})`
        : raw.partnerName || (raw.referenceCode ? `Order ${raw.referenceCode}` : '');

    return {
      provider,
      detectedAction: action,
      referenceCode: raw.referenceCode,
      partnerName: formattedPartner,
      summary: raw.summary,
      extractedTextPreview: raw.extractedTextPreview,
      warnings,
      items: groundedItems,
    };
  }
}
