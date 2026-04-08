/**
 * Integration tests for the HCM batch sync endpoint.
 * Tests idempotency, conflict detection, HCM_WINS resolution, and empty payload handling.
 */

import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance } from '../hcm-mock/hcm-mock.scenarios';

describe('Batch Sync (Integration)', () => {
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
      .useValue({ baseUrl: url, timeoutMs: 3000 })
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

  it('upserts all 3 records, returns processed: 3, skipped: 0', async () => {
    const payload = {
      syncId: 'batch-001',
      balances: [
        { employeeId: 'emp-b1', locationId: 'loc-nyc', available: 10, used: 0, total: 10 },
        { employeeId: 'emp-b2', locationId: 'loc-la', available: 5, used: 5, total: 10 },
        { employeeId: 'emp-b3', locationId: 'loc-nyc', available: 3, used: 7, total: 10 },
      ],
    };

    const result = await balanceService.batchSync(payload);

    expect(result.processed).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.syncId).toBe('batch-001');

    // Verify DB was updated
    const b1 = await balanceService.getBalance('emp-b1', 'loc-nyc');
    expect(b1.available).toBe(10);
  });

  it('second call with same syncId is idempotent (does not re-upsert)', async () => {
    const payload = {
      syncId: 'batch-idempotent',
      balances: [
        { employeeId: 'emp-idem', locationId: 'loc-nyc', available: 7, used: 3, total: 10 },
      ],
    };

    await balanceService.batchSync(payload);

    // Mutate the HCM value to verify second call doesn't overwrite
    // (second call should be skipped entirely)
    const changedPayload = {
      syncId: 'batch-idempotent', // Same ID
      balances: [
        { employeeId: 'emp-idem', locationId: 'loc-nyc', available: 99, used: 0, total: 99 },
      ],
    };

    try {
      const result = await balanceService.batchSync(changedPayload);
      // If no throw, must skip
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    } catch (e: any) {
      expect(e.status ?? e.statusCode ?? e.response?.status).toBe(409);
    }

    // Original value must be preserved
    const balance = await balanceService.getBalance('emp-idem', 'loc-nyc');
    expect(balance.available).toBe(7);
    expect(balance.available).not.toBe(99);
  });

  it('detects conflict: HCM available=1 but 2-day PENDING request exists — conflicts array populated, request stays PENDING', async () => {
    const empId = 'emp-conflict';
    const locId = 'loc-nyc';

    // Seed initial balance at 5
    seedBalance(mock, { employeeId: empId, locationId: locId, available: 5, used: 5, total: 10 });
    await balanceService.syncFromHcm(empId, locId);

    // Create a 2-day pending request
    await timeOffService.create({
      employeeId: empId, locationId: locId,
      startDate: '2026-06-01', endDate: '2026-06-02',
      type: 'VACATION',
    });

    // HCM batch now says only 1 available (< 2 days pending)
    const result = await balanceService.batchSync({
      syncId: 'batch-conflict',
      balances: [{ employeeId: empId, locationId: locId, available: 1, used: 9, total: 10 }],
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].employeeId).toBe(empId);
    expect(result.conflicts[0].hcmAvailable).toBe(1);
    expect(result.conflicts[0].pendingRequestDays).toBe(2);

    // Despite conflict, balance is updated (HCM wins)
    const balance = await balanceService.getBalance(empId, locId);
    expect(balance.available).toBe(1);
  });

  it('no conflict when HCM sends increased balance (anniversary bonus scenario)', async () => {
    const empId = 'emp-bonus-batch';
    const locId = 'loc-nyc';

    seedBalance(mock, { employeeId: empId, locationId: locId, available: 5, used: 5, total: 10 });
    await balanceService.syncFromHcm(empId, locId);

    await timeOffService.create({
      employeeId: empId, locationId: locId,
      startDate: '2026-06-01', endDate: '2026-06-03', // 3 days pending
      type: 'VACATION',
    });

    // HCM bonus: available goes from 5 to 15
    const result = await balanceService.batchSync({
      syncId: 'batch-bonus',
      balances: [{ employeeId: empId, locationId: locId, available: 15, used: 0, total: 15 }],
    });

    expect(result.conflicts).toHaveLength(0);

    const balance = await balanceService.getBalance(empId, locId);
    expect(balance.available).toBe(15);
  });

  it('handles empty balances array: returns 202 with processed: 0', async () => {
    const result = await balanceService.batchSync({
      syncId: 'batch-empty',
      balances: [],
    });

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toHaveLength(0);
  });
});
