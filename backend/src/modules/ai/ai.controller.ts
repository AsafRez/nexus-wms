import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUserPayload, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';

class AiHistoryTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(2500)
  content: string;
}

class AiChatBodyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1500)
  message: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AiHistoryTurnDto)
  history?: AiHistoryTurnDto[];
}

class AnalyzeOrderImageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(25_000_000)
  imageBase64: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  mimeType: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  fileName?: string;

  @IsOptional()
  @IsIn(['INSERT', 'REMOVE'])
  hintAction?: 'INSERT' | 'REMOVE';
}

@Controller('warehouses/:id/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(
    @Param('id') warehouseId: string,
    @Body() dto: AiChatBodyDto,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.aiService.chatWithWarehouse(
      warehouseId,
      user.businessId,
      dto.message,
      dto.history ?? [],
    );
  }

  @Post('analyze-order')
  async analyzeOrder(
    @Param('id') warehouseId: string,
    @Body() dto: AnalyzeOrderImageDto,
    @CurrentUser() user: AuthenticatedUserPayload,
  ) {
    return this.aiService.analyzeOrderDocument(warehouseId, user.businessId, {
      imageBase64: dto.imageBase64,
      mimeType: dto.mimeType,
      fileName: dto.fileName,
      hintAction: dto.hintAction,
    });
  }
}

