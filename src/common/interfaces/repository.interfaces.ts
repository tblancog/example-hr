import { BalanceEntity } from '../../balance/balance.entity';
import { SyncLogEntity } from '../../balance/sync-log.entity';
import { TimeOffRequestEntity } from '../../time-off/time-off.entity';

export interface IBalanceRepository {
  findByEmployeeLocation(employeeId: string, locationId: string): Promise<BalanceEntity | null>;
  upsert(data: Partial<BalanceEntity>): Promise<void>;
  findPendingDaysForEmployeeLocation(employeeId: string, locationId: string): Promise<number>;
}

export interface ISyncLogRepository {
  insert(data: Partial<SyncLogEntity>): Promise<void>;
  findBySyncId(syncId: string): Promise<SyncLogEntity | null>;
}

// Loose input types reflect the service's internal DTOs which may carry
// string-typed enum fields validated upstream by class-validator.
export interface TimeOffCreateInput {
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  type: string;
  note?: string | null;
  daysRequested: number;
  status: string;
}

export interface TimeOffFilters {
  employeeId?: string;
  locationId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface ITimeOffRepository {
  create(data: TimeOffCreateInput): Promise<TimeOffRequestEntity>;
  findById(id: string): Promise<TimeOffRequestEntity | null>;
  update(id: string, data: Partial<TimeOffRequestEntity>): Promise<TimeOffRequestEntity>;
  findOverlapping(employeeId: string, locationId: string, startDate: string, endDate: string): Promise<TimeOffRequestEntity[]>;
  findByFilters(filters: TimeOffFilters): Promise<TimeOffRequestEntity[]>;
  countByFilters(filters: TimeOffFilters): Promise<number>;
}
