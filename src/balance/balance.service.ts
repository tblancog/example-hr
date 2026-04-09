import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { HcmService } from '../hcm/hcm.service';
import { SyncSource, SyncTrigger } from '../common/enums';
import { InsufficientBalanceException } from '../common/exceptions/insufficient-balance.exception';

export interface SyncResult {
  employeeId: string;
  locationId: string;
  available: number;
  used: number;
  total: number;
  source: string;
  lastSyncedAt: Date;
  previousAvailable: number | undefined;
}

export interface ConflictRecord {
  employeeId: string;
  locationId: string;
  hcmAvailable: number;
  pendingRequestDays: number;
  resolution: 'HCM_WINS';
}

export interface BatchSyncResult {
  syncId: string;
  processed: number;
  skipped: number;
  conflicts: ConflictRecord[];
}

@Injectable()
export class BalanceService {
  private readonly processedSyncIds = new Set<string>();

  constructor(
    private readonly hcmService: HcmService,
    @Inject('BALANCE_REPOSITORY') private readonly balanceRepository: any,
    @Inject('SYNC_LOG_REPOSITORY') private readonly syncLogRepository: any,
  ) {}

  async syncFromHcm(
    employeeId: string,
    locationId: string,
  ): Promise<SyncResult> {
    const hcmBalance = await this.hcmService.getBalance(employeeId, locationId);

    const existing = await this.balanceRepository.findByEmployeeLocation(
      employeeId,
      locationId,
    );
    const previousAvailable: number | undefined = existing?.available;
    const lastSyncedAt = new Date();

    await this.balanceRepository.upsert({
      employeeId,
      locationId,
      available: hcmBalance.available,
      used: hcmBalance.used,
      total: hcmBalance.total,
      source: SyncSource.HCM_REALTIME,
      lastSyncedAt,
    });

    await this.syncLogRepository.insert({
      employeeId,
      locationId,
      previousAvailable,
      newAvailable: hcmBalance.available,
      trigger: SyncTrigger.REALTIME_API,
    });

    return {
      employeeId,
      locationId,
      available: hcmBalance.available,
      used: hcmBalance.used,
      total: hcmBalance.total,
      source: SyncSource.HCM_REALTIME,
      lastSyncedAt,
      previousAvailable,
    };
  }

  async checkAndDeductBalance(
    employeeId: string,
    locationId: string,
    daysRequested: number,
  ): Promise<void> {
    const hcmBalance = await this.hcmService.getBalance(employeeId, locationId);

    if (hcmBalance.available < daysRequested) {
      throw new InsufficientBalanceException(
        hcmBalance.available,
        daysRequested,
      );
    }

    const newBalance = {
      available: hcmBalance.available - daysRequested,
      used: hcmBalance.used + daysRequested,
      total: hcmBalance.total,
    };

    const confirmedBalance = await this.hcmService.setBalance(
      employeeId,
      locationId,
      newBalance,
    );
    const lastSyncedAt = new Date();

    await this.balanceRepository.upsert({
      employeeId,
      locationId,
      available: confirmedBalance.available,
      used: confirmedBalance.used,
      total: confirmedBalance.total,
      source: SyncSource.HCM_REALTIME,
      lastSyncedAt,
    });

    await this.syncLogRepository.insert({
      employeeId,
      locationId,
      previousAvailable: hcmBalance.available,
      newAvailable: confirmedBalance.available,
      trigger: SyncTrigger.APPROVAL_CHECK,
    });
  }

  async getBalance(employeeId: string, locationId: string): Promise<any> {
    const balance = await this.balanceRepository.findByEmployeeLocation(
      employeeId,
      locationId,
    );
    if (!balance) {
      throw new NotFoundException(
        `No balance record found for ${employeeId}/${locationId}`,
      );
    }
    return balance;
  }

  async batchSync(payload: {
    syncId: string;
    balances: any[];
  }): Promise<BatchSyncResult> {
    const { syncId, balances } = payload;

    if (this.processedSyncIds.has(syncId)) {
      throw new ConflictException(`Sync ID ${syncId} already processed`);
    }
    this.processedSyncIds.add(syncId);

    if (balances.length === 0) {
      return { syncId, processed: 0, skipped: 0, conflicts: [] };
    }

    const conflicts: ConflictRecord[] = [];
    const lastSyncedAt = new Date();

    for (const item of balances) {
      const { employeeId, locationId, available, used, total } = item;

      const pendingDays =
        await this.balanceRepository.findPendingDaysForEmployeeLocation(
          employeeId,
          locationId,
        );

      if (pendingDays > available) {
        conflicts.push({
          employeeId,
          locationId,
          hcmAvailable: available,
          pendingRequestDays: pendingDays,
          resolution: 'HCM_WINS',
        });
      }

      await this.balanceRepository.upsert({
        employeeId,
        locationId,
        available,
        used,
        total,
        source: SyncSource.HCM_BATCH,
        lastSyncedAt,
      });

      await this.syncLogRepository.insert({
        syncId,
        employeeId,
        locationId,
        newAvailable: available,
        trigger: SyncTrigger.BATCH,
        conflictNotes:
          conflicts.length > 0
            ? JSON.stringify(conflicts[conflicts.length - 1])
            : undefined,
      });
    }

    return {
      syncId,
      processed: balances.length,
      skipped: 0,
      conflicts,
    };
  }
}
