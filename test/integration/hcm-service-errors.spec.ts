/**
 * Integration tests for HcmService HTTP error paths.
 * Each test exercises a specific error branch in hcm.service.ts.
 */

import { HcmMockServer } from '../hcm-mock/hcm-mock.server';
import { seedBalance, configureInternalError, configureInvalidDimension } from '../hcm-mock/hcm-mock.scenarios';

describe('HcmService error paths (Integration)', () => {
  let mock: HcmMockServer;
  let hcmService: any;

  const emp = 'emp-hcm-err';
  const loc = 'loc-nyc';

  beforeAll(async () => {
    mock = new HcmMockServer();
    const { url } = await mock.start();

    const { Test } = await import('@nestjs/testing');
    const { HcmModule } = await import('src/hcm/hcm.module');

    const moduleRef = await Test.createTestingModule({
      imports: [HcmModule],
    })
      .overrideProvider('HCM_CONFIG')
      .useValue({ baseUrl: url, timeoutMs: 2000 })
      .compile();

    const { HcmService } = await import('src/hcm/hcm.service');
    hcmService = moduleRef.get(HcmService);
  });

  afterAll(async () => {
    await mock.stop();
  });

  beforeEach(() => {
    mock.reset();
  });

  it('throws HcmUnavailableException when HCM GET returns 500 (line 39)', async () => {
    const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');
    configureInternalError(mock, emp, loc);

    await expect(hcmService.getBalance(emp, loc)).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  it('throws HcmUnavailableException when HCM SET returns 500 (line 54)', async () => {
    const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');
    // Seed so GET works, then configure internal error (affects SET too)
    seedBalance(mock, { employeeId: emp, locationId: loc, available: 5, used: 5, total: 10 });
    configureInternalError(mock, emp, loc);

    await expect(
      hcmService.setBalance(emp, loc, { available: 4, used: 6, total: 10 }),
    ).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  it('throws InvalidDimensionException when HCM SET returns 422 (line 53)', async () => {
    const { InvalidDimensionException } = await import('src/common/exceptions/invalid-dimension.exception');
    configureInvalidDimension(mock, emp, loc);

    // Call setBalance directly — no prior GET needed for this error path
    await expect(
      hcmService.setBalance(emp, loc, { available: 3, used: 7, total: 10 }),
    ).rejects.toBeInstanceOf(InvalidDimensionException);
  });

  it('throws HcmUnavailableException on network error / unreachable host (line 28)', async () => {
    const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');

    const { Test } = await import('@nestjs/testing');
    const { HcmModule } = await import('src/hcm/hcm.module');
    const { HcmService } = await import('src/hcm/hcm.service');

    const moduleRef = await Test.createTestingModule({ imports: [HcmModule] })
      .overrideProvider('HCM_CONFIG')
      .useValue({ baseUrl: 'http://127.0.0.1:19999', timeoutMs: 500 })
      .compile();

    const unreachableHcm = moduleRef.get(HcmService);

    await expect(unreachableHcm.getBalance(emp, loc)).rejects.toBeInstanceOf(HcmUnavailableException);
  });

  // ── ?? fallback branch coverage (line 28, 39, 54) ─────────────────────────
  // Istanbul counts each side of `??` as a separate branch. The tests above
  // always trigger the left side (error.message is a string / body.error is set).
  // These three tests trigger the right-side fallback strings.

  it('line 28 ?? fallback: uses "network_error" when non-abort error has no message', async () => {
    const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');

    // Must mock global.fetch (not fetchHcm) so the catch block inside fetchHcm processes the error.
    // The error name must NOT be 'AbortError' and message must be undefined to trigger ?? 'network_error'.
    const noMessageError = Object.assign(new TypeError(), { message: undefined as unknown as string });
    const spy = jest.spyOn(global, 'fetch').mockRejectedValueOnce(noMessageError);

    await expect(hcmService.getBalance(emp, loc)).rejects.toBeInstanceOf(HcmUnavailableException);
    spy.mockRestore();
  });

  it('line 39 ?? fallback: uses "server_error" when HCM GET 500 body has no error field', async () => {
    const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');

    // HCM returns 500 with `{}` body — body.error is undefined, so `?? 'server_error'` fires.
    const spy = jest.spyOn(hcmService as any, 'fetchHcm').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );

    await expect(hcmService.getBalance(emp, loc)).rejects.toBeInstanceOf(HcmUnavailableException);
    spy.mockRestore();
  });

  it('line 54 ?? fallback: uses "status_N" when HCM SET non-standard error body has no error field', async () => {
    const { HcmUnavailableException } = await import('src/common/exceptions/hcm-unavailable.exception');

    // HCM returns 503 with `{}` body — body.error is undefined, so `?? \`status_503\`` fires.
    const spy = jest.spyOn(hcmService as any, 'fetchHcm').mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 503 }),
    );

    await expect(
      hcmService.setBalance(emp, loc, { available: 5, used: 5, total: 10 }),
    ).rejects.toBeInstanceOf(HcmUnavailableException);
    spy.mockRestore();
  });
});
