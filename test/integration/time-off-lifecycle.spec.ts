/**
 * Integration tests for the full time-off request lifecycle.
 * Uses real SQLite :memory: DB and the real HCM mock server.
 * The NestJS app is bootstrapped via TestingModule.
 */

import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance, assertCallCount, getSetCalls, getGetCalls } from '../hcm-mock/hcm-mock.scenarios';

describe('Time-Off Lifecycle (Integration)', () => {
  let app: any;
  let mock: HcmMockServer;
  let timeOffService: any;
  let balanceService: any;

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

    const { TimeOffService } = await import('src/time-off/time-off.service');
    const { BalanceService } = await import('src/balance/balance.service');
    timeOffService = moduleRef.get(TimeOffService);
    balanceService = moduleRef.get(BalanceService);
  });

  afterAll(async () => {
    await app.close();
    await mock.stop();
  });

  beforeEach(() => {
    mock.reset();
  });

  describe('create → approve flow', () => {
    it('creates a PENDING request and approves it, HCM receives exactly GET + SET', async () => {
      seedBalance(mock, { employeeId: 'emp-001', locationId: 'loc-nyc', available: 10, used: 2, total: 12 });

      const request = await timeOffService.create({
        employeeId: 'emp-001', locationId: 'loc-nyc',
        startDate: '2026-06-01', endDate: '2026-06-03',
        type: 'VACATION',
      });

      expect(request.status).toBe('PENDING');
      expect(request.daysRequested).toBe(3);

      const approved = await timeOffService.approve(request.id, { managerId: 'mgr-001' });

      expect(approved.status).toBe('APPROVED');
      expect(approved.managerId).toBe('mgr-001');

      // HCM must have received exactly 1 GET and 1 SET
      assertCallCount(mock, 2);
      const getCalls = getGetCalls(mock);
      const setCalls = getSetCalls(mock);
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0].employeeId).toBe('emp-001');
      expect(setCalls).toHaveLength(1);
      expect(setCalls[0].employeeId).toBe('emp-001');
    });

    it('local balance cache is updated to HCM-confirmed value after approval', async () => {
      seedBalance(mock, { employeeId: 'emp-002', locationId: 'loc-la', available: 8, used: 2, total: 10 });

      const request = await timeOffService.create({
        employeeId: 'emp-002', locationId: 'loc-la',
        startDate: '2026-07-01', endDate: '2026-07-03',
        type: 'VACATION',
      });

      await timeOffService.approve(request.id, { managerId: 'mgr-001' });

      const balance = await balanceService.getBalance('emp-002', 'loc-la');
      expect(balance.available).toBe(5); // 8 - 3
    });
  });

  describe('create → reject flow', () => {
    it('rejects a request without touching HCM (0 SET calls)', async () => {
      const request = await timeOffService.create({
        employeeId: 'emp-003', locationId: 'loc-nyc',
        startDate: '2026-08-01', endDate: '2026-08-02',
        type: 'SICK',
      });

      const rejected = await timeOffService.reject(request.id, { managerId: 'mgr-001', reason: 'Coverage needed' });

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Coverage needed');
      expect(getSetCalls(mock)).toHaveLength(0);
      expect(getGetCalls(mock)).toHaveLength(0);
    });
  });

  describe('create → cancel flow', () => {
    it('cancels a PENDING request, status becomes CANCELLED, balance untouched', async () => {
      seedBalance(mock, { employeeId: 'emp-004', locationId: 'loc-nyc', available: 5, used: 0, total: 5 });

      const request = await timeOffService.create({
        employeeId: 'emp-004', locationId: 'loc-nyc',
        startDate: '2026-09-01', endDate: '2026-09-02',
        type: 'PERSONAL',
      });

      const cancelled = await timeOffService.cancel(request.id);

      expect(cancelled.status).toBe('CANCELLED');
      assertCallCount(mock, 0); // No HCM calls for cancel
    });
  });

  describe('list endpoint filtering', () => {
    it('returns only requests matching employeeId filter', async () => {
      await timeOffService.create({
        employeeId: 'emp-filter-a', locationId: 'loc-nyc',
        startDate: '2026-10-01', endDate: '2026-10-02', type: 'VACATION',
      });
      await timeOffService.create({
        employeeId: 'emp-filter-b', locationId: 'loc-nyc',
        startDate: '2026-10-01', endDate: '2026-10-02', type: 'VACATION',
      });

      const result = await timeOffService.findAll({ employeeId: 'emp-filter-a' });

      expect(result.data.every((r: any) => r.employeeId === 'emp-filter-a')).toBe(true);
      const empBRequests = result.data.filter((r: any) => r.employeeId === 'emp-filter-b');
      expect(empBRequests).toHaveLength(0);
    });

    it('returns only PENDING requests when status filter is applied', async () => {
      seedBalance(mock, { employeeId: 'emp-status-test', locationId: 'loc-nyc', available: 10, used: 0, total: 10 });

      const req1 = await timeOffService.create({
        employeeId: 'emp-status-test', locationId: 'loc-nyc',
        startDate: '2026-11-01', endDate: '2026-11-02', type: 'VACATION',
      });
      const req2 = await timeOffService.create({
        employeeId: 'emp-status-test', locationId: 'loc-nyc',
        startDate: '2026-11-10', endDate: '2026-11-11', type: 'VACATION',
      });

      await timeOffService.approve(req1.id, { managerId: 'mgr-001' });
      mock.reset(); // Reset call log but keep balance

      const result = await timeOffService.findAll({
        employeeId: 'emp-status-test',
        status: 'PENDING',
      });

      expect(result.data.every((r: any) => r.status === 'PENDING')).toBe(true);
      expect(result.data.find((r: any) => r.id === req2.id)).toBeDefined();
    });

    it('pagination returns correct slice: page=2, limit=2 with 5 records', async () => {
      const empId = 'emp-paginate';
      for (let i = 1; i <= 5; i++) {
        await timeOffService.create({
          employeeId: empId, locationId: 'loc-nyc',
          startDate: `2026-0${i + 1}-01`, endDate: `2026-0${i + 1}-02`,
          type: 'VACATION',
        });
      }

      const result = await timeOffService.findAll({ employeeId: empId, page: 2, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(2);
      expect(result.total).toBe(5);
    });
  });
});
