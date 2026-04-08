import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceEntity } from './balance.entity';
import { SyncLogEntity } from './sync-log.entity';
import { BalanceRepository } from './balance.repository';
import { SyncLogRepository } from './sync-log.repository';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [TypeOrmModule.forFeature([BalanceEntity, SyncLogEntity]), HcmModule],
  providers: [
    BalanceService,
    { provide: 'BALANCE_REPOSITORY', useClass: BalanceRepository },
    { provide: 'SYNC_LOG_REPOSITORY', useClass: SyncLogRepository },
  ],
  controllers: [BalanceController],
  exports: [BalanceService],
})
export class BalanceModule {}
