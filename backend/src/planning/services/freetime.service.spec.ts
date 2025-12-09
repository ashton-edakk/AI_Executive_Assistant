import { Test, TestingModule } from '@nestjs/testing';
import { FreeTimeService } from './freetime.service';

describe('FreeTimeService', () => {
  let service: FreeTimeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FreeTimeService],
    }).compile();

    service = module.get<FreeTimeService>(FreeTimeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
