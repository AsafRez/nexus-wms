import { WarehouseAiContext } from '../ai-context.model';
import { AiChatMessage, AiExecutedAction } from '../ai.types';

export interface CopilotTurnResult {
  reply: string;
  provider: 'GEMINI' | 'LOCAL_WMS_ENGINE';
  executedActions: AiExecutedAction[];
}

/**
 * Abstract OOP base class for AI Copilot providers (Strategy Pattern).
 */
export abstract class AiCopilotProvider {
  public abstract readonly providerName: 'GEMINI' | 'LOCAL_WMS_ENGINE';

  public abstract isConfigured(): boolean;

  public abstract generateReply(
    ctx: WarehouseAiContext,
    userMessage: string,
    history: AiChatMessage[],
  ): Promise<CopilotTurnResult>;
}
