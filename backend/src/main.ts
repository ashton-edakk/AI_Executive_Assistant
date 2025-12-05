import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * The main entry point for the NestJS application.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // --- Security Configuration for Web Apps ---
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:8080',
      'https://ai-executive-assistant-frontend.pages.dev', // Cloudflare Pages URL
      'https://ai-executive-assistant-1o1t.onrender.com',  // Render backend URL
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });


  const port = process.env.PORT || 8080;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
