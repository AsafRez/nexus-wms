import {
  AiChatMessageDto,
  AiChatResponseDto,
  AnalyzeOrderImageRequestDto,
  AnalyzeOrderImageResponseDto,
} from '../../../shared/wms.contracts';
import { HttpClient, sharedHttpClient } from './HttpClient';

export class AiApiService {
  constructor(private readonly client: HttpClient = sharedHttpClient) {}

  async sendMessage(
    warehouseId: string,
    message: string,
    history: AiChatMessageDto[],
  ): Promise<AiChatResponseDto> {
    return this.client.post<AiChatResponseDto>(`/warehouses/${warehouseId}/ai/chat`, {
      message,
      history,
    });
  }

  async analyzeOrderImage(
    warehouseId: string,
    payload: AnalyzeOrderImageRequestDto,
  ): Promise<AnalyzeOrderImageResponseDto> {
    return this.client.post<AnalyzeOrderImageResponseDto>(
      `/warehouses/${warehouseId}/ai/analyze-order`,
      payload,
    );
  }
}

export const aiApiService = new AiApiService();

