import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { HcmModule } from './hcm/hcm.module';
import { BalanceModule } from './balance/balance.module';
import { TimeOffModule } from './time-off/time-off.module';
import { BalanceEntity } from './balance/balance.entity';
import { SyncLogEntity } from './balance/sync-log.entity';
import { TimeOffRequestEntity } from './time-off/time-off.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [BalanceEntity, SyncLogEntity, TimeOffRequestEntity],
      synchronize: true,
    }),
    HcmModule,
    BalanceModule,
    TimeOffModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
