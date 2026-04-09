/**
 * Integration tests for error recovery and atomicity.
 * Verifies that failed operations leave DB and request state unchanged (no partial writes).
 */

import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import {
  seedBalance,
  configureInternalError,
  configureTimeout,
  clearScenario,
} from '../hcm-mock/hcm-mock.scenarios';

describe('Error recovery and atomicity (Integration)', () => {
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
      .useValue({ baseUrl: url, timeoutMs: 1500 })
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

  it('approve fails with HcmUnavailableException when HCM GET returns 500 — request stays PENDING', async () => {
    const { HcmUnavailableException } =
      await import('src/common/exceptions/hcm-unavailable.exception');
    const emp = 'emp-rec-01';
    const loc = 'loc-nyc';

    seedBalance(mock, {
      employeeId: emp,
      locationId: loc,
      available: 10,
      used: 0,
      total: 10,
    });
    const request = await timeOffService.create({
      employeeId: emp,
      locationId: loc,
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      type: 'VACATION',
    });

    // Make HCM return 500 on the approval GET
    configureInternalError(mock, emp, loc);

    await expect(
      timeOffService.approve(request.id, { managerId: 'mgr-001' }),
    ).rejects.toBeInstanceOf(HcmUnavailableException);

    // Request must remain PENDING
    const refetched = await timeOffService.findById(request.id);
    expect(refetched.status).toBe('PENDING');
  });

  it('approve fails with HcmUnavailableException on GET timeout — request stays PENDING, retry after clear succeeds', async () => {
    const { HcmUnavailableException } =
      await import('src/common/exceptions/hcm-unavailable.exception');
    const emp = 'emp-rec-02';
    const loc = 'loc-nyc';

    seedBalance(mock, {
      employeeId: emp,
      locationId: loc,
      available: 5,
      used: 5,
      total: 10,
    });
    const request = await timeOffService.create({
      employeeId: emp,
      locationId: loc,
      startDate: '2026-07-10',
      endDate: '2026-07-12',
      type: 'VACATION',
    });

    // First approval attempt — timeout
    configureTimeout(mock, emp, loc);
    await expect(
      timeOffService.approve(request.id, { managerId: 'mgr-001' }),
    ).rejects.toBeInstanceOf(HcmUnavailableException);

    const afterTimeout = await timeOffService.findById(request.id);
    expect(afterTimeout.status).toBe('PENDING');

    // Clear timeout and retry — should succeed
    clearScenario(mock, emp, loc);
    const approved = await timeOffService.approve(request.id, {
      managerId: 'mgr-001',
    });
    expect(approved.status).toBe('APPROVED');
  });

  it('checkAndDeductBalance: DB balance NOT updated when HCM SET fails', async () => {
    const emp = 'emp-rec-03';
    const loc = 'loc-nyc';

    // Seed and sync to establish a known DB balance
    seedBalance(mock, {
      employeeId: emp,
      locationId: loc,
      available: 8,
      used: 2,
      total: 10,
    });
    await balanceService.syncFromHcm(emp, loc);

    const before = await balanceService.getBalance(emp, loc);
    expect(before.available).toBe(8);

    // Now configure internal error so SET will fail
    configureInternalError(mock, emp, loc);

    // checkAndDeductBalance: GET works (seed is still there for GET), SET fails
    // But with INTERNAL_ERROR, GET also fails → use a different approach:
    // Re-seed normal data so GET succeeds, but configure set-fail-on-call for SET
    mock.reset();
    seedBalance(mock, {
      employeeId: emp,
      locationId: loc,
      available: 8,
      used: 2,
      total: 10,
    });

    // The mock's configureSetFailOnCall makes the 1st SET return insufficient_balance
    mock.configureSetFailOnCall(`${emp}:${loc}`, 1);

    const { InsufficientBalanceException } =
      await import('src/common/exceptions/insufficient-balance.exception');
    await expect(
      balanceService.checkAndDeductBalance(emp, loc, 3),
    ).rejects.toBeInstanceOf(InsufficientBalanceException);

    // DB balance must still be 8 — no partial write
    const after = await balanceService.getBalance(emp, loc);
    expect(after.available).toBe(8);
  });
});
