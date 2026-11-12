import { Module } from '@nestjs/common';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { AiToolExecutorService } from './ai-tool-executor.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiCopilotProvider } from './providers/gemini-copilot.provider';
import { LocalWmsCopilotProvider } from './providers/local-wms-copilot.provider';
import { OrderDocumentAnalyzerService } from './order-document-analyzer.service';

@Module({
  imports: [WarehousesModule],
  controllers: [AiController],
  providers: [
    AiService,
    AiToolExecutorService,
    GeminiCopilotProvider,
    LocalWmsCopilotProvider,
    OrderDocumentAnalyzerService,
  ],
})
export class AiModule {}

