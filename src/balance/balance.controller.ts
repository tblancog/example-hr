import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BalanceService } from './balance.service';
import { SyncBalanceDto } from './dto/sync-balance.dto';
import { BatchSyncDto } from './dto/batch-sync.dto';

@Controller('balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':employeeId/:locationId')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.balanceService.getBalance(employeeId, locationId);
  }

  @Post('sync')
  syncBalance(@Body() dto: SyncBalanceDto) {
    return this.balanceService.syncFromHcm(dto.employeeId, dto.locationId);
  }

  @Post('batch-sync')
  @HttpCode(HttpStatus.ACCEPTED)
  batchSync(@Body() dto: BatchSyncDto) {
    return this.balanceService.batchSync(dto);
  }
}
