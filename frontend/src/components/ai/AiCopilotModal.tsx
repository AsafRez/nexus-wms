import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, X } from 'lucide-react';
import {
  AiChatMessageDto,
  AiExecutedActionDto,
} from '../../../../shared/wms.contracts';
import { useWarehouse } from '../../context/WarehouseContext';
import { aiApiService } from '../../services/AiApiService';

interface ChatTurnView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  executedActions?: AiExecutedActionDto[];
}

interface AiCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  'Capacity and row summary',
  'Recommend open cells for putaway',
  'List current SKU inventory',
  'Recent inbound & outbound log',
];

export const AiCopilotModal: React.FC<AiCopilotModalProps> = ({ isOpen, onClose }) => {
  const { selectedWarehouse, refreshWarehouses } = useWarehouse();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [turns, setTurns] = useState<ChatTurnView[]>([]);
  const [input, setInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState<'GEMINI' | 'LOCAL_WMS_ENGINE' | null>(null);

  // Sync native <dialog> open/close state
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
      console.warn('AiCopilotModal showModal/close error:', err);
    }
  }, [isOpen]);

  // Reset welcome message when switching warehouses
  useEffect(() => {
    if (!selectedWarehouse) return;
    setTurns([
      {
        id: `welcome-${selectedWarehouse.id}`,
        role: 'assistant',
        content: `Connected to ${selectedWarehouse.name} (${selectedWarehouse.code} · ${selectedWarehouse.formattedFullLabel}). Ask about open matrix cells, SKU quantities, dock activity, or tell me to insert/remove items directly.`,
      },
    ]);
    setErrorMsg(null);
  }, [selectedWarehouse?.id]);

  // Auto-scroll to newest message when open
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [turns, isOpen]);

  const submitPrompt = async (promptText: string) => {
    const clean = promptText.trim();
    if (!clean || !selectedWarehouse || isSending) return;

    const userTurn: ChatTurnView = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: clean,
    };

    const historyForApi: AiChatMessageDto[] = turns
      .filter((t) => !t.id.startsWith('welcome-'))
      .map((t) => ({ role: t.role, content: t.content }));

    setTurns((prev) => [...prev, userTurn]);
    setInput('');
    setErrorMsg(null);
    setIsSending(true);

    try {
      const response = await aiApiService.sendMessage(
        selectedWarehouse.id,
        clean,
        historyForApi,
      );

      setProviderLabel(response.provider);
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: response.reply,
          executedActions: response.executedActions,
        },
      ]);

      if (response.executedActions.length > 0) {
        await refreshWarehouses();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI request failed.');
    } finally {
      setIsSending(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitPrompt(input);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current && !isSending) {
      onClose();
    }
  };

  if (!selectedWarehouse) return null;

  return (
    <dialog
      ref={dialogRef}
      className="wms-modal-dialog ai-modal-dialog"
      onCancel={(e) => {
        if (isSending) {
          e.preventDefault();
          return;
        }
        onClose();
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="wms-modal-sheet ai-modal-sheet corner-frame"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="corner top-left" />
        <span className="corner top-right" />
        <span className="corner bottom-left" />
        <span className="corner bottom-right" />

        {/* Header */}
        <div className="wms-modal-head">
          <div className="ai-head-left">
            <span className="ai-head-badge" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div>
              <div className="ai-head-title-row">
                <h2>Helper Boxiy</h2>
                <span className="ai-engine-chip mono">
                  {providerLabel === 'GEMINI' ? 'Gemini API' : 'Live WMS engine'}
                </span>
              </div>
              <p className="wms-modal-sub tabular">
                {selectedWarehouse.name} ({selectedWarehouse.code}) ·{' '}
                {selectedWarehouse.formattedFullLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close Helper Boxiy modal"
            onClick={onClose}
            disabled={isSending}
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Prompts Strip */}
        <div className="ai-quick-strip">
          {QUICK_PROMPTS.map((qp) => (
            <button
              key={qp}
              type="button"
              className="ai-prompt-chip"
              disabled={isSending}
              onClick={() => submitPrompt(qp)}
            >
              {qp}
            </button>
          ))}
        </div>

        {/* Transcript */}
        <div className="ai-transcript" role="log" aria-live="polite">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`ai-turn ${turn.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="ai-turn-meta mono">
                {turn.role === 'user' ? 'Operator' : 'Helper Boxiy'}
              </div>
              <div className="ai-turn-bubble tabular">{turn.content}</div>

              {turn.executedActions && turn.executedActions.length > 0 && (
                <div className="ai-actions-list">
                  {turn.executedActions.map((act, idx) => (
                    <div key={idx} className="ai-action-receipt tabular">
                      <span
                        className={`direction-tag ${act.direction === 'INBOUND' ? 'in' : 'out'
                          }`}
                      >
                        {act.direction === 'INBOUND'
                          ? 'Inserted'
                          : act.direction === 'OUTBOUND'
                            ? 'Removed'
                            : 'Adjusted'}
                      </span>
                      <span>{act.summary}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isSending && (
            <div className="ai-turn assistant">
              <div className="ai-turn-meta mono">Helper Boxiy</div>
              <div className="ai-turn-bubble ai-thinking">
                Checking {selectedWarehouse.code} matrix and inventory...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {errorMsg && <div className="inline-error ai-inline-error">{errorMsg}</div>}

        {/* Composer */}
        <form onSubmit={handleFormSubmit} className="ai-composer">
          <input
            type="text"
            className="ai-composer-input"
            placeholder={`Ask about ${selectedWarehouse.code} or e.g. "Insert 10 scanners into G-01"...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isSending}
          />
          <button
            type="submit"
            className="primary-action-btn ai-send-btn"
            disabled={isSending || !input.trim()}
          >
            <Send size={15} />
            <span>Send</span>
          </button>
        </form>
      </div>
    </dialog>
  );
};

