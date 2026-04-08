/**
 * Integration tests for balance sync flows.
 * Tests real-time HCM sync, boundary conditions, and anniversary bonus scenarios.
 */

import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance, configureTimeout, configureInvalidDimension, clearScenario } from '../hcm-mock/hcm-mock.scenarios';

describe('Balance Sync (Integration)', () => {
  let app: any;
  let mock: HcmMockServer;
  let balanceService: any;
  let timeOffService: any;

  beforeAll(async () => {
    mock = new HcmMockServer();
    const { url } = await mock.start();

    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('src/app.module');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('HCM_CONFIG')
      .useValue({ baseUrl: url, timeoutMs: 2000 })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const { BalanceService } = await import('src/balance/balance.service');
    const { TimeOffService } = await import('src/time-off/time-off.service');
    balanceService = moduleRef.get(BalanceService);
    timeOffService = moduleRef.get(TimeOffService);
  });

  afterAll(async () => {
    await app.close();
    await mock.stop();
  });

  beforeEach(() => {
    mock.reset();
  });

  describe('POST /balances/sync (real-time HCM pull)', () => {
    it('fetches from HCM mock, persists to DB, returns previousAvailable', async () => {
      // Seed a pre-existing DB balance at 5, HCM now has 8 (anniversary bonus)
      seedBalance(mock, { employeeId: 'emp-sync-01', locationId: 'loc-nyc', available: 8, used: 2, total: 10 });

      // First sync to establish local cache at 8
      const first = await balanceService.syncFromHcm('emp-sync-01', 'loc-nyc');
      expect(first.available).toBe(8);

      // HCM bonus: now 11 days
      mock.seed({ employeeId: 'emp-sync-01', locationId: 'loc-nyc', available: 11, used: 2, total: 13 });

      const result = await balanceService.syncFromHcm('emp-sync-01', 'loc-nyc');

      expect(result.available).toBe(11);
      expect(result.previousAvailable).toBe(8);
    });

    it('throws HcmUnavailableException when HCM is in TIMEOUT scenario', async () => {
      const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');
      configureTimeout(mock, 'emp-timeout', 'loc-nyc');

      await expect(balanceService.syncFromHcm('emp-timeout', 'loc-nyc')).rejects.toBeInstanceOf(HcmUnavailableException);
    });

    it('throws InvalidDimensionException when HCM returns invalid dimension error', async () => {
      const { InvalidDimensionException } = await import('src/common/exceptions/invalid-dimension.exception');
      configureInvalidDimension(mock, 'emp-invalid', 'loc-bad');

      await expect(balanceService.syncFromHcm('emp-invalid', 'loc-bad')).rejects.toBeInstanceOf(InvalidDimensionException);
    });
  });

  describe('Balance boundary conditions at approval', () => {
    it('approve succeeds when available === daysRequested (exactly 0 left after)', async () => {
      seedBalance(mock, { employeeId: 'emp-boundary-01', locationId: 'loc-nyc', available: 3, used: 7, total: 10 });

      const request = await timeOffService.create({
        employeeId: 'emp-boundary-01', locationId: 'loc-nyc',
        startDate: '2026-06-01', endDate: '2026-06-03',
        type: 'VACATION',
      });

      const approved = await timeOffService.approve(request.id, { managerId: 'mgr-001' });

      expect(approved.status).toBe('APPROVED');
      const balance = await balanceService.getBalance('emp-boundary-01', 'loc-nyc');
      expect(balance.available).toBe(0);
    });

    it('approve fails with InsufficientBalanceException when available === daysRequested - 1', async () => {
      const { InsufficientBalanceException } = await import('src/common/exceptions/insufficient-balance.exception');
      seedBalance(mock, { employeeId: 'emp-boundary-02', locationId: 'loc-nyc', available: 2, used: 8, total: 10 });

      const request = await timeOffService.create({
        employeeId: 'emp-boundary-02', locationId: 'loc-nyc',
        startDate: '2026-06-01', endDate: '2026-06-03', // 3 days, only 2 available
        type: 'VACATION',
      });

      await expect(timeOffService.approve(request.id, { managerId: 'mgr-001' })).rejects.toBeInstanceOf(InsufficientBalanceException);

      // Request must still be PENDING after failed approval
      const refetched = await timeOffService.findById(request.id);
      expect(refetched.status).toBe('PENDING');
    });

    it('approve fails for fractional boundary: available=0.5, daysRequested=1', async () => {
      const { InsufficientBalanceException } = await import('src/common/exceptions/insufficient-balance.exception');
      seedBalance(mock, { employeeId: 'emp-fraction', locationId: 'loc-nyc', available: 0.5, used: 9.5, total: 10 });

      const request = await timeOffService.create({
        employeeId: 'emp-fraction', locationId: 'loc-nyc',
        startDate: '2026-06-01', endDate: '2026-06-01', // 1 day
        type: 'SICK',
      });

      await expect(timeOffService.approve(request.id, { managerId: 'mgr-001' })).rejects.toBeInstanceOf(InsufficientBalanceException);
    });

    it('approve uses updated balance after HCM bonus (anniversary scenario)', async () => {
      // Employee starts with 3 days
      seedBalance(mock, { employeeId: 'emp-bonus', locationId: 'loc-nyc', available: 3, used: 7, total: 10 });

      const request = await timeOffService.create({
        employeeId: 'emp-bonus', locationId: 'loc-nyc',
        startDate: '2026-06-01', endDate: '2026-06-05', // 5 days — would fail at 3
        type: 'VACATION',
      });

      // Before approval, HCM gives anniversary bonus — now 10 days
      mock.seed({ employeeId: 'emp-bonus', locationId: 'loc-nyc', available: 10, used: 0, total: 10 });

      // Approval should succeed because it re-fetches from HCM
      const approved = await timeOffService.approve(request.id, { managerId: 'mgr-001' });
      expect(approved.status).toBe('APPROVED');
    });
  });
});
