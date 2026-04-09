import { Module, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_PIPE, APP_GUARD } from '@nestjs/core';
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
      // Never use synchronize:true in production — it auto-drops columns on entity changes.
      // Use explicit TypeORM migrations instead.
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    ThrottlerModule.forRoot([
      {
        // Default: 100 requests per 60 seconds per IP
        ttl: 60_000,
        limit: 100,
      },
    ]),
    HcmModule,
    BalanceModule,
    TimeOffModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
