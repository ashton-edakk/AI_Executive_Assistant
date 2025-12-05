import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CalendarController } from './calendar/calendar.controller'; 
import { CalendarService } from './calendar/calendar.service';

// Infra / feature modules
import { DbModule } from './db/db.module';
import { CalendarModule } from './calendar/calendar.module';
import { PlanningModule } from './planning/planning.module';
import { PlanningController } from './planning.controller';

// Gemini + task helpers (MuhdT branch)
import { GeminiService } from './gemini/gemini.service';
import { GeminiController } from './gemini/gemini.controller';
import { ChatController } from './gemini/chat.controller';
import { AuthService } from './auth/auth.service';
import { TasksService } from './tasks/tasks.service';

// Google OAuth / Supabase auth (main branch)
import { GoogleAuthController } from './auth/google-auth.controller';
import { GoogleAuthService } from './auth/google-auth.service';
import { SupabaseAuthGuard } from './auth/supabase.guard';

// Import PlannerService from PlanningModule (exported)
import { PlannerService } from './planning/services/planner.service';

/**
 * Root NestJS module.
 *
 * - Loads env vars globally via ConfigModule
 * - Wires DB + Calendar + Planning modules
 * - Exposes Gemini + GoogleAuth controllers/services
 * - Registers SupabaseAuthGuard for @UseGuards()
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DbModule,
    CalendarModule,
    PlanningModule,
  ],
  controllers: [
    AppController,
    CalendarController,
    GeminiController,
    ChatController,
    PlanningController,
    GoogleAuthController,
  ],
  providers: [
    AppService,
    CalendarService,
    GeminiService,
    AuthService,
    TasksService,
    GoogleAuthService,
    SupabaseAuthGuard,
  ],
})
export class AppModule {}
