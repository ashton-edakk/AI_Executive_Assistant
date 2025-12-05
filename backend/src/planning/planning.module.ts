import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlannerService } from './services/planner.service';
import { ScoringService } from './services/scoring.service';
import { PlacementService } from './services/placement.service';
import { FreeTimeService } from './services/freetime.service';
import { TaskBlocksRepo } from './repo/task-blocks.repo';
import { TasksRepo } from './repo/tasks.repo';
import { CalendarRepo } from './repo/calendar.repo';
import { DbModule } from '../db/db.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ExecService } from './services/exec.service';
import { SessionsRepo } from './repo/sessions.repo';
import { ExecController } from './exec.controller';
import { InsightsRepo } from './repo/insights.repo';
import { InsightsService } from './services/insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [DbModule, CalendarModule],
  controllers: [PlanningController, ExecController, InsightsController],
  providers: [PlannerService, ScoringService, PlacementService, FreeTimeService, TaskBlocksRepo, TasksRepo, CalendarRepo, ExecService, SessionsRepo, InsightsRepo, InsightsService],
  exports: [PlannerService, ExecService, InsightsService], // Export services for use in other modules
})
export class PlanningModule {}

