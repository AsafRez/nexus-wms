import { Injectable } from '@nestjs/common';
import { WarehouseAiContext } from '../ai-context.model';
import { AiToolExecutorService } from '../ai-tool-executor.service';
import { AiChatMessage, AiExecutedAction } from '../ai.types';
import { AiCopilotProvider, CopilotTurnResult } from './ai-copilot.provider';

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

@Injectable()
export class GeminiCopilotProvider extends AiCopilotProvider {
  public readonly providerName = 'GEMINI' as const;

  constructor(private readonly toolExecutor: AiToolExecutorService) {
    super();
  }

  public isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  }

  public async generateReply(
    ctx: WarehouseAiContext,
    userMessage: string,
    history: AiChatMessage[],
  ): Promise<CopilotTurnResult> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const contents: GeminiContent[] = [
      ...history.slice(-8).map((msg) => ({
        role: (msg.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: msg.content }],
      })),
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
    ];

    const tools = [
      {
        functionDeclarations: [
          {
            name: 'insert_inventory_item',
            description:
              'Insert/add units of a catalog product into the active warehouse inventory and place them into a specific storage matrix cell.',
            parameters: {
              type: 'OBJECT',
              properties: {
                skuOrProduct: {
                  type: 'STRING',
                  description: 'Product SKU (e.g. APX-SCN-400) or product name.',
                },
                quantity: {
                  type: 'INTEGER',
                  description: 'Positive integer number of units to insert.',
                },
                cellCode: {
                  type: 'STRING',
                  description:
                    'Optional matrix cell code such as A-01 or G-05. Omit to auto-pick the first open cell.',
                },
              },
              required: ['skuOrProduct', 'quantity'],
            },
          },
          {
            name: 'remove_inventory_item',
            description:
              'Remove/pick units of an existing SKU from the active warehouse inventory and optionally deduct from a storage matrix cell.',
            parameters: {
              type: 'OBJECT',
              properties: {
                skuOrProduct: {
                  type: 'STRING',
                  description: 'Product SKU (e.g. APX-SCN-400) or product name.',
                },
                quantity: {
                  type: 'INTEGER',
                  description: 'Positive integer number of units to remove.',
                },
                cellCode: {
                  type: 'STRING',
                  description: 'Optional occupied matrix cell code such as A-01.',
                },
              },
              required: ['skuOrProduct', 'quantity'],
            },
          },
          {
            name: 'adjust_matrix_cell',
            description:
              'Directly increment or decrement a storage cell item counter without modifying SKU catalog inventory.',
            parameters: {
              type: 'OBJECT',
              properties: {
                cellCode: {
                  type: 'STRING',
                  description: 'Matrix cell code such as A-01.',
                },
                delta: {
                  type: 'INTEGER',
                  description: 'Positive integer to add items or negative integer to remove items.',
                },
              },
              required: ['cellCode', 'delta'],
            },
          },
        ],
      },
    ];

    const executedActions: AiExecutedAction[] = [];

    const firstRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: ctx.buildSystemPromptSummary() }],
        },
        contents,
        tools,
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });

    if (!firstRes.ok) {
      const errBody = await firstRes.text();
      throw new Error(`Gemini API request failed (${firstRes.status}): ${errBody}`);
    }

    const firstJson = (await firstRes.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    };
    const modelParts = firstJson.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = modelParts
      .map((p) => p.functionCall)
      .filter((fc): fc is GeminiFunctionCall => Boolean(fc));

    if (functionCalls.length === 0) {
      const replyText =
        modelParts
          .map((p) => p.text ?? '')
          .join('')
          .trim() || 'Ready to assist with your warehouse operations.';
      return {
        reply: replyText,
        provider: 'GEMINI',
        executedActions,
      };
    }

    // Execute Gemini function calls against live warehouse domain
    const responseParts: GeminiPart[] = [];
    for (const call of functionCalls) {
      let toolResult: { ok: boolean; message: string; executed?: AiExecutedAction };

      if (call.name === 'insert_inventory_item') {
        toolResult = await this.toolExecutor.insertInventoryItem(ctx, {
          skuOrProduct: String(call.args.skuOrProduct ?? ''),
          quantity: Number(call.args.quantity ?? 0),
          cellCode: call.args.cellCode ? String(call.args.cellCode) : undefined,
        });
      } else if (call.name === 'remove_inventory_item') {
        toolResult = await this.toolExecutor.removeInventoryItem(ctx, {
          skuOrProduct: String(call.args.skuOrProduct ?? ''),
          quantity: Number(call.args.quantity ?? 0),
          cellCode: call.args.cellCode ? String(call.args.cellCode) : undefined,
        });
      } else if (call.name === 'adjust_matrix_cell') {
        toolResult = await this.toolExecutor.adjustMatrixCellCounter(ctx, {
          cellCode: String(call.args.cellCode ?? ''),
          delta: Number(call.args.delta ?? 0),
        });
      } else {
        toolResult = { ok: false, message: `Unknown tool: ${call.name}` };
      }

      if (toolResult.executed) {
        executedActions.push(toolResult.executed);
      }

      responseParts.push({
        functionResponse: {
          name: call.name,
          response: {
            ok: toolResult.ok,
            result: toolResult.message,
          },
        },
      });
    }

    // Send function execution results back to Gemini for a clean summary response
    const followUpRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: ctx.buildSystemPromptSummary() }],
        },
        contents: [
          ...contents,
          { role: 'model', parts: modelParts },
          { role: 'user', parts: responseParts },
        ],
        tools,
        generationConfig: {
          temperature: 0.2,
        },
      }),
    });

    if (!followUpRes.ok) {
      const fallbackSummary = responseParts
        .map((p) => String(p.functionResponse?.response?.result ?? ''))
        .join('\n');
      return {
        reply: fallbackSummary || 'Completed warehouse action.',
        provider: 'GEMINI',
        executedActions,
      };
    }

    const followUpJson = (await followUpRes.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    };
    const finalText =
      (followUpJson.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim() ||
      executedActions.map((a) => a.summary).join('\n') ||
      'Completed warehouse request.';

    return {
      reply: finalText,
      provider: 'GEMINI',
      executedActions,
    };
  }
}
