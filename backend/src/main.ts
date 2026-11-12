import * as fs from 'fs';
import * as path from 'path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile();

async function bootstrap() {
  process.on('unhandledRejection', (reason) => {
    console.error('[WMS Process Guard] Unhandled Promise Rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[WMS Process Guard] Uncaught Exception:', err);
  });

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  console.log(`WMS API Server running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/api`);
}

bootstrap();
