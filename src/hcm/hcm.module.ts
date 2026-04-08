import { Module } from '@nestjs/common';
import { HcmService } from './hcm.service';

@Module({
  providers: [
    {
      provide: 'HCM_CONFIG',
      useValue: {
        baseUrl: process.env.HCM_BASE_URL ?? 'http://localhost:3100',
        timeoutMs: parseInt(process.env.HCM_TIMEOUT_MS ?? '5000', 10),
      },
    },
    HcmService,
  ],
  exports: ['HCM_CONFIG', HcmService],
})
export class HcmModule {}
