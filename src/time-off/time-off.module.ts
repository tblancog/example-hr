import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequestEntity } from './time-off.entity';
import { TimeOffRepository } from './time-off.repository';
import { TimeOffService } from './time-off.service';
import { TimeOffController } from './time-off.controller';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [TypeOrmModule.forFeature([TimeOffRequestEntity]), BalanceModule],
  providers: [
    TimeOffService,
    { provide: 'TIME_OFF_REPOSITORY', useClass: TimeOffRepository },
  ],
  controllers: [TimeOffController],
  exports: [TimeOffService],
})
export class TimeOffModule {}
