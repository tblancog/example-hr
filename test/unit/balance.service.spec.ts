/**
 * Unit tests for BalanceService.
 * HcmService and BalanceRepository are replaced with jest.fn() mocks.
 * Tests verify sync logic, conflict detection, and idempotency.
 */

describe('BalanceService', () => {
  let balanceService: any;
  let mockHcmService: any;
  let mockBalanceRepository: any;
  let mockSyncLogRepository: any;

  const emp = 'emp-001';
  const loc = 'loc-nyc';

  beforeEach(async () => {
    const { Test } = await import('@nestjs/testing');
    const { BalanceService } = await import('src/balance/balance.service');
    const { HcmService } = await import('src/hcm/hcm.service');

    mockHcmService = {
      getBalance: jest.fn(),
      setBalance: jest.fn(),
    };

    mockBalanceRepository = {
      findByEmployeeLocation: jest.fn(),
      upsert: jest.fn(),
      findPendingDaysForEmployeeLocation: jest.fn(),
    };

    mockSyncLogRepository = {
      insert: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: HcmService, useValue: mockHcmService },
        { provide: 'BALANCE_REPOSITORY', useValue: mockBalanceRepository },
        { provide: 'SYNC_LOG_REPOSITORY', useValue: mockSyncLogRepository },
      ],
    }).compile();

    balanceService = moduleRef.get(BalanceService);
  });

  describe('syncFromHcm()', () => {
    it('upserts balance in DB when HCM returns valid data', async () => {
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 10,
        used: 2,
        total: 12,
      });
      mockBalanceRepository.findByEmployeeLocation.mockResolvedValueOnce({
        available: 8,
        used: 2,
        total: 10,
      });
      mockBalanceRepository.upsert.mockResolvedValueOnce(undefined);
      mockSyncLogRepository.insert.mockResolvedValueOnce(undefined);

      const result = await balanceService.syncFromHcm(emp, loc);

      expect(mockHcmService.getBalance).toHaveBeenCalledWith(emp, loc);
      expect(mockBalanceRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: emp,
          locationId: loc,
          available: 10,
          used: 2,
          total: 12,
        }),
      );
      expect(result.available).toBe(10);
      expect(result.previousAvailable).toBe(8);
    });

    it('sets source to HCM_REALTIME after sync', async () => {
      const { SyncSource } = await import('src/common/enums');
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 5,
        used: 0,
        total: 5,
      });
      mockBalanceRepository.findByEmployeeLocation.mockResolvedValueOnce(null);
      mockBalanceRepository.upsert.mockResolvedValueOnce(undefined);
      mockSyncLogRepository.insert.mockResolvedValueOnce(undefined);

      await balanceService.syncFromHcm(emp, loc);

      expect(mockBalanceRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ source: SyncSource.HCM_REALTIME }),
      );
    });

    it('updates lastSyncedAt timestamp on sync', async () => {
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 5,
        used: 0,
        total: 5,
      });
      mockBalanceRepository.findByEmployeeLocation.mockResolvedValueOnce(null);
      mockBalanceRepository.upsert.mockResolvedValueOnce(undefined);
      mockSyncLogRepository.insert.mockResolvedValueOnce(undefined);

      const before = new Date();
      await balanceService.syncFromHcm(emp, loc);
      const after = new Date();

      const upsertCall = mockBalanceRepository.upsert.mock.calls[0][0];
      const syncedAt = new Date(upsertCall.lastSyncedAt);
      expect(syncedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(syncedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('throws HcmUnavailableException when HCM service throws timeout', async () => {
      const { HcmUnavailableException } =
        await import('src/common/exceptions/hcm-unavailable.exception');
      mockHcmService.getBalance.mockRejectedValueOnce(
        new HcmUnavailableException('timeout'),
      );

      await expect(balanceService.syncFromHcm(emp, loc)).rejects.toBeInstanceOf(
        HcmUnavailableException,
      );
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });

    it('throws InvalidDimensionException when HCM service throws invalid dimension', async () => {
      const { InvalidDimensionException } =
        await import('src/common/exceptions/invalid-dimension.exception');
      mockHcmService.getBalance.mockRejectedValueOnce(
        new InvalidDimensionException(emp, loc),
      );

      await expect(balanceService.syncFromHcm(emp, loc)).rejects.toBeInstanceOf(
        InvalidDimensionException,
      );
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('batchSync()', () => {
    it('upserts all records and returns correct processed count', async () => {
      const syncId = 'sync-001';
      const balances = [
        {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          available: 10,
          used: 2,
          total: 12,
        },
        {
          employeeId: 'emp-002',
          locationId: 'loc-la',
          available: 5,
          used: 0,
          total: 5,
        },
        {
          employeeId: 'emp-003',
          locationId: 'loc-nyc',
          available: 3,
          used: 7,
          total: 10,
        },
      ];

      mockBalanceRepository.findPendingDaysForEmployeeLocation.mockResolvedValue(
        0,
      );
      mockBalanceRepository.upsert.mockResolvedValue(undefined);
      mockSyncLogRepository.insert.mockResolvedValue(undefined);

      const result = await balanceService.batchSync({ syncId, balances });

      expect(result.processed).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.syncId).toBe(syncId);
      expect(mockBalanceRepository.upsert).toHaveBeenCalledTimes(3);
    });

    it('returns 409 or skips on duplicate syncId (idempotency)', async () => {
      const syncId = 'sync-duplicate';
      const balances = [
        {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          available: 10,
          used: 2,
          total: 12,
        },
      ];

      // First call succeeds
      mockBalanceRepository.findPendingDaysForEmployeeLocation.mockResolvedValue(
        0,
      );
      mockBalanceRepository.upsert.mockResolvedValue(undefined);
      mockSyncLogRepository.insert.mockResolvedValue(undefined);

      await balanceService.batchSync({ syncId, balances });

      // Second call with same syncId should either throw or return skipped: 1
      mockBalanceRepository.upsert.mockClear();

      try {
        const result = await balanceService.batchSync({ syncId, balances });
        // If it doesn't throw, it should skip all records
        expect(result.skipped).toBeGreaterThanOrEqual(1);
        expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
      } catch (e: any) {
        // If it throws, it should be a conflict error (409)
        expect(e.status ?? e.statusCode ?? e.response?.status).toBe(409);
      }
    });

    it('detects conflict when hcmAvailable < sum of pending request days', async () => {
      const syncId = 'sync-conflict';
      const balances = [
        { employeeId: emp, locationId: loc, available: 1, used: 4, total: 5 },
      ];

      // 3 pending days but HCM only shows 1 available
      mockBalanceRepository.findPendingDaysForEmployeeLocation.mockResolvedValueOnce(
        3,
      );
      mockBalanceRepository.upsert.mockResolvedValue(undefined);
      mockSyncLogRepository.insert.mockResolvedValue(undefined);

      const result = await balanceService.batchSync({ syncId, balances });

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].employeeId).toBe(emp);
      expect(result.conflicts[0].locationId).toBe(loc);
      expect(result.conflicts[0].hcmAvailable).toBe(1);
      expect(result.conflicts[0].pendingRequestDays).toBe(3);
    });

    it('uses HCM_WINS resolution: updates cache even when conflict exists', async () => {
      const { SyncSource } = await import('src/common/enums');
      const syncId = 'sync-conflict-wins';
      const balances = [
        { employeeId: emp, locationId: loc, available: 1, used: 9, total: 10 },
      ];

      mockBalanceRepository.findPendingDaysForEmployeeLocation.mockResolvedValueOnce(
        5,
      );
      mockBalanceRepository.upsert.mockResolvedValue(undefined);
      mockSyncLogRepository.insert.mockResolvedValue(undefined);

      const result = await balanceService.batchSync({ syncId, balances });

      // Balance MUST be updated despite conflict
      expect(mockBalanceRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ available: 1, source: SyncSource.HCM_BATCH }),
      );
      expect(result.conflicts[0].resolution).toBe('HCM_WINS');
    });

    it('returns 202 with processed: 0 when balances array is empty', async () => {
      const result = await balanceService.batchSync({
        syncId: 'sync-empty',
        balances: [],
      });

      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.conflicts).toHaveLength(0);
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('checkAndDeductBalance()', () => {
    it('calls HCM GET then SET with correctly decremented values', async () => {
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 10,
        used: 2,
        total: 12,
      });
      mockHcmService.setBalance.mockResolvedValueOnce({
        available: 7,
        used: 5,
        total: 12,
      });
      mockBalanceRepository.upsert.mockResolvedValueOnce(undefined);
      mockSyncLogRepository.insert.mockResolvedValueOnce(undefined);

      await balanceService.checkAndDeductBalance(emp, loc, 3);

      expect(mockHcmService.getBalance).toHaveBeenCalledWith(emp, loc);
      expect(mockHcmService.setBalance).toHaveBeenCalledWith(emp, loc, {
        available: 7,
        used: 5,
        total: 12,
      });
      expect(mockBalanceRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ available: 7, used: 5, total: 12 }),
      );
    });

    it('throws InsufficientBalanceException before SET when available < daysRequested', async () => {
      const { InsufficientBalanceException } =
        await import('src/common/exceptions/insufficient-balance.exception');
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 2,
        used: 8,
        total: 10,
      });

      await expect(
        balanceService.checkAndDeductBalance(emp, loc, 3),
      ).rejects.toBeInstanceOf(InsufficientBalanceException);
      expect(mockHcmService.setBalance).not.toHaveBeenCalled();
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });

    it('allows exact deduction when available === daysRequested (boundary: 0 left)', async () => {
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 3,
        used: 7,
        total: 10,
      });
      mockHcmService.setBalance.mockResolvedValueOnce({
        available: 0,
        used: 10,
        total: 10,
      });
      mockBalanceRepository.upsert.mockResolvedValueOnce(undefined);
      mockSyncLogRepository.insert.mockResolvedValueOnce(undefined);

      await expect(
        balanceService.checkAndDeductBalance(emp, loc, 3),
      ).resolves.not.toThrow();
      expect(mockHcmService.setBalance).toHaveBeenCalledWith(emp, loc, {
        available: 0,
        used: 10,
        total: 10,
      });
    });

    it('propagates HcmUnavailableException from GET without touching DB', async () => {
      const { HcmUnavailableException } =
        await import('src/common/exceptions/hcm-unavailable.exception');
      mockHcmService.getBalance.mockRejectedValueOnce(
        new HcmUnavailableException('timeout'),
      );

      await expect(
        balanceService.checkAndDeductBalance(emp, loc, 3),
      ).rejects.toBeInstanceOf(HcmUnavailableException);
      expect(mockHcmService.setBalance).not.toHaveBeenCalled();
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });

    it('propagates InsufficientBalanceException from HCM SET (race) without updating DB', async () => {
      const { InsufficientBalanceException } =
        await import('src/common/exceptions/insufficient-balance.exception');
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 5,
        used: 5,
        total: 10,
      });
      mockHcmService.setBalance.mockRejectedValueOnce(
        new InsufficientBalanceException(0, 5),
      );

      await expect(
        balanceService.checkAndDeductBalance(emp, loc, 5),
      ).rejects.toBeInstanceOf(InsufficientBalanceException);
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });

    it('propagates InvalidDimensionException from HCM SET without updating DB', async () => {
      const { InvalidDimensionException } =
        await import('src/common/exceptions/invalid-dimension.exception');
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 10,
        used: 0,
        total: 10,
      });
      mockHcmService.setBalance.mockRejectedValueOnce(
        new InvalidDimensionException(emp, loc),
      );

      await expect(
        balanceService.checkAndDeductBalance(emp, loc, 3),
      ).rejects.toBeInstanceOf(InvalidDimensionException);
      expect(mockBalanceRepository.upsert).not.toHaveBeenCalled();
    });

    it('uses fractional deduction correctly (0.5 days)', async () => {
      mockHcmService.getBalance.mockResolvedValueOnce({
        available: 1.5,
        used: 8.5,
        total: 10,
      });
      mockHcmService.setBalance.mockResolvedValueOnce({
        available: 1.0,
        used: 9.0,
        total: 10,
      });
      mockBalanceRepository.upsert.mockResolvedValueOnce(undefined);
      mockSyncLogRepository.insert.mockResolvedValueOnce(undefined);

      await balanceService.checkAndDeductBalance(emp, loc, 0.5);

      expect(mockHcmService.setBalance).toHaveBeenCalledWith(emp, loc, {
        available: 1.0,
        used: 9.0,
        total: 10,
      });
    });
  });

  describe('getBalance()', () => {
    it('returns the balance from DB when record exists', async () => {
      const dbBalance = {
        employeeId: emp,
        locationId: loc,
        available: 7,
        used: 3,
        total: 10,
        lastSyncedAt: new Date(),
        source: 'HCM_REALTIME',
      };
      mockBalanceRepository.findByEmployeeLocation.mockResolvedValueOnce(
        dbBalance,
      );

      const result = await balanceService.getBalance(emp, loc);
      expect(result).toMatchObject({
        employeeId: emp,
        locationId: loc,
        available: 7,
      });
    });

    it('throws NotFoundException when no balance record exists for employee+location', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockBalanceRepository.findByEmployeeLocation.mockResolvedValueOnce(null);

      await expect(balanceService.getBalance(emp, loc)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
