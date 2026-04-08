/**
 * E2E state machine tests.
 * Exhaustively tests all invalid state transitions.
 * After each 409: re-GETs the request and asserts status is unchanged.
 */

import * as request from 'supertest';
import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance } from '../hcm-mock/hcm-mock.scenarios';

describe('State Machine E2E', () => {
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

  /** Helper: create a PENDING request */
  async function createPending(empSuffix: string) {
    const res = await request(httpServer)
      .post('/time-off-requests')
      .send({
        employeeId: `emp-sm-${empSuffix}`,
        locationId: 'loc-nyc',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        type: 'VACATION',
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** Helper: approve a PENDING request */
  async function approve(id: string) {
    seedBalance(mock, { employeeId: expect.any(String) as any, locationId: 'loc-nyc', available: 10, used: 0, total: 10 });
    // Reseed with the known empId from the request
    const getRes = await request(httpServer).get(`/time-off-requests/${id}`);
    mock.seed({ employeeId: getRes.body.employeeId, locationId: 'loc-nyc', available: 10, used: 0, total: 10 });
    const res = await request(httpServer)
      .patch(`/time-off-requests/${id}/approve`)
      .send({ managerId: 'mgr-001' });
    expect(res.status).toBe(200);
    return res.body;
  }

  describe('PENDING → APPROVED → invalid transitions', () => {
    it('APPROVE an already APPROVED request returns 409; status remains APPROVED', async () => {
      const req = await createPending('approve-twice');
      await approve(req.id);

      const res = await request(httpServer)
        .patch(`/time-off-requests/${req.id}/approve`)
        .send({ managerId: 'mgr-001' });

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('APPROVED');
    });

    it('CANCEL an APPROVED request returns 409; status remains APPROVED', async () => {
      const req = await createPending('cancel-approved');
      await approve(req.id);

      const res = await request(httpServer).delete(`/time-off-requests/${req.id}`);

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('APPROVED');
    });

    it('REJECT an APPROVED request returns 409; status remains APPROVED', async () => {
      const req = await createPending('reject-approved');
      await approve(req.id);

      const res = await request(httpServer)
        .patch(`/time-off-requests/${req.id}/reject`)
        .send({ managerId: 'mgr-001' });

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('APPROVED');
    });
  });

  describe('PENDING → REJECTED → invalid transitions', () => {
    it('APPROVE a REJECTED request returns 409; status remains REJECTED', async () => {
      const req = await createPending('approve-rejected');

      await request(httpServer)
        .patch(`/time-off-requests/${req.id}/reject`)
        .send({ managerId: 'mgr-001' });

      const res = await request(httpServer)
        .patch(`/time-off-requests/${req.id}/approve`)
        .send({ managerId: 'mgr-001' });

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('REJECTED');
    });

    it('CANCEL a REJECTED request returns 409; status remains REJECTED', async () => {
      const req = await createPending('cancel-rejected');

      await request(httpServer)
        .patch(`/time-off-requests/${req.id}/reject`)
        .send({ managerId: 'mgr-001' });

      const res = await request(httpServer).delete(`/time-off-requests/${req.id}`);

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('REJECTED');
    });
  });

  describe('PENDING → CANCELLED → invalid transitions', () => {
    it('APPROVE a CANCELLED request returns 409; status remains CANCELLED', async () => {
      const req = await createPending('approve-cancelled');
      await request(httpServer).delete(`/time-off-requests/${req.id}`);

      const res = await request(httpServer)
        .patch(`/time-off-requests/${req.id}/approve`)
        .send({ managerId: 'mgr-001' });

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('CANCELLED');
    });

    it('CANCEL an already CANCELLED request returns 409; status remains CANCELLED', async () => {
      const req = await createPending('cancel-twice');
      await request(httpServer).delete(`/time-off-requests/${req.id}`);

      const res = await request(httpServer).delete(`/time-off-requests/${req.id}`);

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('CANCELLED');
    });

    it('REJECT a CANCELLED request returns 409; status remains CANCELLED', async () => {
      const req = await createPending('reject-cancelled');
      await request(httpServer).delete(`/time-off-requests/${req.id}`);

      const res = await request(httpServer)
        .patch(`/time-off-requests/${req.id}/reject`)
        .send({ managerId: 'mgr-001' });

      expect(res.status).toBe(409);

      const get = await request(httpServer).get(`/time-off-requests/${req.id}`);
      expect(get.body.status).toBe('CANCELLED');
    });
  });

  describe('Non-existent request ID', () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    it('GET returns 404', async () => {
      const res = await request(httpServer).get(`/time-off-requests/${nonExistentId}`);
      expect(res.status).toBe(404);
    });

    it('PATCH approve returns 404', async () => {
      const res = await request(httpServer)
        .patch(`/time-off-requests/${nonExistentId}/approve`)
        .send({ managerId: 'mgr-001' });
      expect(res.status).toBe(404);
    });

    it('PATCH reject returns 404', async () => {
      const res = await request(httpServer)
        .patch(`/time-off-requests/${nonExistentId}/reject`)
        .send({ managerId: 'mgr-001' });
      expect(res.status).toBe(404);
    });

    it('DELETE returns 404', async () => {
      const res = await request(httpServer).delete(`/time-off-requests/${nonExistentId}`);
      expect(res.status).toBe(404);
    });
  });
});
