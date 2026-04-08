/**
 * Integration tests for concurrent request handling.
 * Tests the HCM-as-safety-net pattern for race conditions.
 * Uses Promise.all to truly parallelize approvals.
 */

import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance, configureSetRaceFail } from '../hcm-mock/hcm-mock.scenarios';

describe('Concurrent Requests (Integration)', () => {
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

  it('two sequential approvals: second fails when first exhausted the balance', async () => {
    const { InsufficientBalanceException } = await import('src/common/exceptions/insufficient-balance.exception');
    seedBalance(mock, { employeeId: 'emp-seq', locationId: 'loc-nyc', available: 3, used: 7, total: 10 });

    const req1 = await timeOffService.create({
      employeeId: 'emp-seq', locationId: 'loc-nyc',
      startDate: '2026-06-01', endDate: '2026-06-03', // 3 days
      type: 'VACATION',
    });
    const req2 = await timeOffService.create({
      employeeId: 'emp-seq', locationId: 'loc-nyc',
      startDate: '2026-07-01', endDate: '2026-07-02', // 2 days
      type: 'VACATION',
    });

    // First approval succeeds, exhausts balance
    await timeOffService.approve(req1.id, { managerId: 'mgr-001' });

    // Second approval fails — HCM now has 0 available
    await expect(timeOffService.approve(req2.id, { managerId: 'mgr-001' })).rejects.toBeInstanceOf(InsufficientBalanceException);

    // req2 must still be PENDING
    const req2Status = await timeOffService.findById(req2.id);
    expect(req2Status.status).toBe('PENDING');
  });

  it('two simultaneous POST requests with overlapping dates: second returns ConflictException', async () => {
    const { ConflictException } = await import('@nestjs/common');

    const createReq = () =>
      timeOffService.create({
        employeeId: 'emp-overlap', locationId: 'loc-nyc',
        startDate: '2026-06-01', endDate: '2026-06-05',
        type: 'VACATION',
      });

    // Fire both at the same time
    const [result1, result2] = await Promise.allSettled([createReq(), createReq()]);

    const successes = [result1, result2].filter((r) => r.status === 'fulfilled');
    const failures = [result1, result2].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    if (failures[0].status === 'rejected') {
      expect(failures[0].reason).toBeInstanceOf(ConflictException);
    }
  });

  it('HCM SET race: 2nd SET call fails — 2nd approval returns InsufficientBalanceException, 1st is APPROVED', async () => {
    const { InsufficientBalanceException } = await import('src/common/exceptions/insufficient-balance.exception');

    seedBalance(mock, { employeeId: 'emp-race', locationId: 'loc-nyc', available: 5, used: 5, total: 10 });

    // Configure mock to fail the 2nd SET call (simulating race condition)
    configureSetRaceFail(mock, 'emp-race', 'loc-nyc', 2);

    const req1 = await timeOffService.create({
      employeeId: 'emp-race', locationId: 'loc-nyc',
      startDate: '2026-06-01', endDate: '2026-06-03', // 3 days
      type: 'VACATION',
    });
    const req2 = await timeOffService.create({
      employeeId: 'emp-race', locationId: 'loc-nyc',
      startDate: '2026-07-01', endDate: '2026-07-03', // 3 days
      type: 'VACATION',
    });

    // Approve both concurrently — HCM SET races
    const [result1, result2] = await Promise.allSettled([
      timeOffService.approve(req1.id, { managerId: 'mgr-001' }),
      timeOffService.approve(req2.id, { managerId: 'mgr-002' }),
    ]);

    const successes = [result1, result2].filter((r) => r.status === 'fulfilled');
    const failures = [result1, result2].filter((r) => r.status === 'rejected');

    // Exactly one must succeed
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The failure must be InsufficientBalanceException (HCM caught the race)
    if (failures[0].status === 'rejected') {
      expect(failures[0].reason).toBeInstanceOf(InsufficientBalanceException);
    }

    // The failed request must remain PENDING
    const failedReqId = (failures[0] as any).reason?.requestId ??
      (result1.status === 'rejected' ? req1.id : req2.id);
    const failedReq = await timeOffService.findById(failedReqId);
    expect(failedReq.status).toBe('PENDING');
  });
});
