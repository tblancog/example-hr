import { TimeOffType, RequestStatus, SyncSource } from '../src/common/enums';

export interface TimeOffRequestDto {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  type: TimeOffType;
  status: RequestStatus;
  note?: string | null;
  managerId?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceDto {
  employeeId: string;
  locationId: string;
  available: number;
  used: number;
  total: number;
  lastSyncedAt: string;
  source: SyncSource;
}

export interface SyncBalanceResponseDto extends BalanceDto {
  previousAvailable: number;
}

export interface ConflictRecord {
  employeeId: string;
  locationId: string;
  hcmAvailable: number;
  pendingRequestDays: number;
  resolution: 'HCM_WINS' | 'FLAGGED_FOR_REVIEW';
}

export interface BatchSyncResponseDto {
  syncId: string;
  processed: number;
  skipped: number;
  conflicts: ConflictRecord[];
}

export interface PaginatedResponseDto<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface HcmBalance {
  employeeId: string;
  locationId: string;
  available: number;
  used: number;
  total: number;
}

export interface HcmCall {
  timestamp: string;
  method: 'GET' | 'SET' | 'BATCH' | 'TEST';
  path: string;
  employeeId?: string;
  locationId?: string;
  body?: unknown;
  responseStatus: number;
}
