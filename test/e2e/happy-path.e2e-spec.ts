/**
 * E2E happy path tests.
 * Full NestJS app boots, supertest sends HTTP requests.
 * Validates response shapes match DTO contracts exactly.
 */

import * as request from 'supertest';
import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance } from '../hcm-mock/hcm-mock.scenarios';
import { TimeOffRequestDto, BalanceDto } from '../types';
import { RequestStatus, TimeOffType, SyncSource } from '../../src/common/enums';

describe('Happy Path E2E', () => {
  let app: any;
  let httpServer: any;
  let mock: HcmMockServer;

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
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await mock.stop();
  });

  beforeEach(() => {
    mock.reset();
  });

  describe('Full lifecycle: create → approve → check balance', () => {
    it('POST 201 → PATCH approve 200 → GET balance shows decremented value', async () => {
      seedBalance(mock, {
        employeeId: 'emp-e2e-01',
        locationId: 'loc-nyc',
        available: 10,
        used: 2,
        total: 12,
      });

      // Step 1: Create request
      const createRes = await request(httpServer)
        .post('/time-off-requests')
        .send({
          employeeId: 'emp-e2e-01',
          locationId: 'loc-nyc',
          startDate: '2026-06-01',
          endDate: '2026-06-03',
          type: 'VACATION',
        });

      expect(createRes.status).toBe(201);
      const created: TimeOffRequestDto = createRes.body;
      expect(created.id).toBeDefined();
      expect(created.status).toBe(RequestStatus.PENDING);
      expect(created.daysRequested).toBe(3);
      expect(created.employeeId).toBe('emp-e2e-01');
      expect(created.locationId).toBe('loc-nyc');
      expect(created.startDate).toBe('2026-06-01');
      expect(created.endDate).toBe('2026-06-03');
      expect(created.type).toBe(TimeOffType.VACATION);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      // Step 2: Approve
      const approveRes = await request(httpServer)
        .patch(`/time-off-requests/${created.id}/approve`)
        .send({ managerId: 'mgr-001' });

      expect(approveRes.status).toBe(200);
      const approved: TimeOffRequestDto = approveRes.body;
      expect(approved.status).toBe(RequestStatus.APPROVED);
      expect(approved.managerId).toBe('mgr-001');
      expect(approved.id).toBe(created.id);

      // Step 3: Check balance shows decremented value
      const balanceRes = await request(httpServer).get(
        '/balances/emp-e2e-01/loc-nyc',
      );

      expect(balanceRes.status).toBe(200);
      const balance: BalanceDto = balanceRes.body;
      expect(balance.available).toBe(7); // 10 - 3
      expect(balance.employeeId).toBe('emp-e2e-01');
      expect(balance.locationId).toBe('loc-nyc');
      expect(balance.source).toBe(SyncSource.HCM_REALTIME);
      expect(balance.lastSyncedAt).toBeDefined();
    });
  });

  describe('Response shape contracts', () => {
    it('GET /time-off-requests/:id returns all required fields', async () => {
      const createRes = await request(httpServer)
        .post('/time-off-requests')
        .send({
          employeeId: 'emp-shape-test',
          locationId: 'loc-la',
          startDate: '2026-07-01',
          endDate: '2026-07-02',
          type: 'SICK',
          note: 'Feeling unwell',
        });

      const getRes = await request(httpServer).get(
        `/time-off-requests/${createRes.body.id}`,
      );

      expect(getRes.status).toBe(200);
      const dto: TimeOffRequestDto = getRes.body;
      expect(dto).toHaveProperty('id');
      expect(dto).toHaveProperty('employeeId');
      expect(dto).toHaveProperty('locationId');
      expect(dto).toHaveProperty('startDate');
      expect(dto).toHaveProperty('endDate');
      expect(dto).toHaveProperty('daysRequested');
      expect(dto).toHaveProperty('type');
      expect(dto).toHaveProperty('status');
      expect(dto).toHaveProperty('createdAt');
      expect(dto).toHaveProperty('updatedAt');
      expect(dto.note).toBe('Feeling unwell');
    });

    it('GET /time-off-requests/:id returns 404 for unknown UUID', async () => {
      const res = await request(httpServer).get(
        '/time-off-requests/00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(404);
    });

    it('GET /balances/:employeeId/:locationId returns all required fields', async () => {
      seedBalance(mock, {
        employeeId: 'emp-bal-shape',
        locationId: 'loc-nyc',
        available: 5,
        used: 5,
        total: 10,
      });
      await request(httpServer)
        .post('/balances/sync')
        .send({ employeeId: 'emp-bal-shape', locationId: 'loc-nyc' });

      const res = await request(httpServer).get(
        '/balances/emp-bal-shape/loc-nyc',
      );
      expect(res.status).toBe(200);
      const dto: BalanceDto = res.body;
      expect(dto).toHaveProperty('employeeId');
      expect(dto).toHaveProperty('locationId');
      expect(dto).toHaveProperty('available');
      expect(dto).toHaveProperty('used');
      expect(dto).toHaveProperty('total');
      expect(dto).toHaveProperty('lastSyncedAt');
      expect(dto).toHaveProperty('source');
    });
  });

  describe('POST /time-off-requests validation', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(httpServer)
        .post('/time-off-requests')
        .send({ employeeId: 'emp-001' }); // missing everything else

      expect(res.status).toBe(400);
    });

    it('returns 400 when endDate is before startDate', async () => {
      const res = await request(httpServer).post('/time-off-requests').send({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        startDate: '2026-06-10',
        endDate: '2026-06-05',
        type: 'VACATION',
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 when a request overlaps an existing PENDING request', async () => {
      await request(httpServer).post('/time-off-requests').send({
        employeeId: 'emp-409',
        locationId: 'loc-nyc',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        type: 'VACATION',
      });

      const res = await request(httpServer).post('/time-off-requests').send({
        employeeId: 'emp-409',
        locationId: 'loc-nyc',
        startDate: '2026-06-03',
        endDate: '2026-06-07', // overlaps
        type: 'VACATION',
      });

      expect(res.status).toBe(409);
    });
  });
});
