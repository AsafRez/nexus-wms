import { BadRequestException, Injectable } from '@nestjs/common';
import { WarehousesService } from '../warehouses/warehouses.service';
import { WarehouseAiContext } from './ai-context.model';
import { AiChatMessage } from './ai.types';
import { GeminiCopilotProvider } from './providers/gemini-copilot.provider';
import { LocalWmsCopilotProvider } from './providers/local-wms-copilot.provider';
import { OrderDocumentAnalyzerService } from './order-document-analyzer.service';

@Injectable()
export class AiService {
  constructor(
    private readonly warehousesService: WarehousesService,
    private readonly geminiProvider: GeminiCopilotProvider,
    private readonly localProvider: LocalWmsCopilotProvider,
    private readonly orderDocumentAnalyzer: OrderDocumentAnalyzerService,
  ) {}

  private detectPromptInjectionOrExfiltration(message: string): string | null {
    const lower = message.toLowerCase();

    const isDirectJailbreak =
      /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|commands)/i.test(
        lower,
      ) ||
      /\b(system\s+override|developer\s+mode|jailbreak|reveal\s+system\s+prompt|print\s+your\s+raw\s+system\s+prompt)\b/i.test(
        lower,
      ) ||
      /התעלם\s+מ(כל\s+)?ה?(הוראות|פקודות|הנחיות|חוקים)/.test(message);

    const isSecretExfiltration =
      /\b(database_url|jwt_secret|process\.env|gemini_api_key|openai_api_key|password_hash|passwordhash)\b/i.test(
        lower,
      );

    // Indirect injection: external document (invoice / delivery note / email) embedding a stock mutation
    const mentionsExternalDoc =
      /\b(invoice|supplier\s+note|delivery\s+note|manifest\s+note|email\s+from)\b/i.test(lower) ||
      /(חשבונית|תעודת\s+משלוח|הערת\s+ספק|מייל\s+מספק)/.test(message);
    const hasEmbeddedMutationInQuotes =
      mentionsExternalDoc &&
      /["'“”].*\b(insert|add|remove|delete|deduct|withdraw|transfer|wipe)\b.*["'“”]/i.test(message);

    if (isSecretExfiltration) {
      return 'Security guardrail: I cannot access or disclose environment variables, credentials, or internal system configuration.';
    }
    if (isDirectJailbreak || hasEmbeddedMutationInQuotes) {
      return 'Security guardrail: Prompt-injection or untrusted document instruction detected. I ignored the embedded override command and made zero changes to warehouse stock.';
    }
    return null;
  }

  async chatWithWarehouse(
    warehouseId: string,
    businessId: string,
    message: string,
    history: AiChatMessage[] = [],
  ) {
    const cleanMessage = message?.trim();
    if (!cleanMessage) {
      throw new BadRequestException('Message cannot be empty.');
    }

    const [dashboard, inventory, catalog] = await Promise.all([
      this.warehousesService.getDashboard(warehouseId, businessId),
      this.warehousesService.getInventory(warehouseId, businessId),
      this.warehousesService.getCatalogProducts(warehouseId, businessId),
    ]);

    const securityBlock = this.detectPromptInjectionOrExfiltration(cleanMessage);
    if (securityBlock) {
      return {
        reply: securityBlock,
        provider: this.geminiProvider.isConfigured()
          ? ('GEMINI' as const)
          : ('LOCAL_WMS_ENGINE' as const),
        executedActions: [],
        warehouse: dashboard.warehouse,
      };
    }

    const ctx = new WarehouseAiContext(businessId, dashboard, inventory, catalog);

    let turnResult;
    if (this.geminiProvider.isConfigured()) {
      try {
        turnResult = await this.geminiProvider.generateReply(ctx, cleanMessage, history);
      } catch (err) {
        console.warn('Gemini Copilot failed, falling back to Local WMS Engine:', err);
        turnResult = await this.localProvider.generateReply(ctx, cleanMessage, history);
      }
    } else {
      turnResult = await this.localProvider.generateReply(ctx, cleanMessage, history);
    }

    let latestWarehouse = dashboard.warehouse;
    if (turnResult.executedActions.length > 0) {
      const refreshedList = await this.warehousesService.listBusinessWarehouses(businessId);
      latestWarehouse =
        refreshedList.find((w) => w.id === warehouseId) ?? dashboard.warehouse;
    }

    return {
      reply: turnResult.reply,
      provider: turnResult.provider,
      executedActions: turnResult.executedActions,
      warehouse: latestWarehouse,
    };
  }

  async analyzeOrderDocument(
    warehouseId: string,
    businessId: string,
    params: {
      imageBase64: string;
      mimeType: string;
      fileName?: string;
      hintAction?: 'INSERT' | 'REMOVE';
    },
  ) {
    const [dashboard, inventory, catalog] = await Promise.all([
      this.warehousesService.getDashboard(warehouseId, businessId),
      this.warehousesService.getInventory(warehouseId, businessId),
      this.warehousesService.getCatalogProducts(warehouseId, businessId),
    ]);

    const ctx = new WarehouseAiContext(businessId, dashboard, inventory, catalog);
    return this.orderDocumentAnalyzer.analyzeOrderConfirmation(ctx, params);
  }
}
