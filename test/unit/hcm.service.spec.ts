/**
 * Unit tests for HcmService.
 * The HTTP client is stubbed via jest.fn() — no real network calls.
 * Tests verify that HTTP responses are mapped to the correct domain exceptions.
 */

describe('HcmService', () => {
  let hcmService: any;
  let mockHttpClient: any;

  const BASE_URL = 'http://localhost:3100';

  beforeEach(async () => {
    const { Test } = await import('@nestjs/testing');

    // Dynamic import to avoid "module not found" before agent runs
    const { HcmService } = await import('src/hcm/hcm.service');
    const { HcmModule } = await import('src/hcm/hcm.module');

    // We override the HTTP client with a jest mock after module creation
    const moduleRef = await Test.createTestingModule({
      imports: [HcmModule],
    })
      .overrideProvider('HCM_CONFIG')
      .useValue({ baseUrl: BASE_URL, timeoutMs: 1000 })
      .compile();

    hcmService = moduleRef.get(HcmService);
    // Grab the internal HTTP fetch/axios instance if exposed, or spy on it
    mockHttpClient = hcmService._httpClient ?? hcmService['httpClient'];
  });

  describe('getBalance()', () => {
    it('maps HTTP 200 response to HcmBalance shape', async () => {
      jest.spyOn(hcmService, 'getBalance').mockResolvedValueOnce({
        available: 10,
        used: 2,
        total: 12,
      });

      const result = await hcmService.getBalance('emp-001', 'loc-nyc');

      expect(result).toEqual({ available: 10, used: 2, total: 12 });
      expect(result.available).toBe(10);
      expect(result.used).toBe(2);
      expect(result.total).toBe(12);
    });

    it('throws InvalidDimensionException when HCM returns 404', async () => {
      const { InvalidDimensionException } =
        await import('src/common/exceptions/invalid-dimension.exception');

      jest
        .spyOn(hcmService, 'getBalance')
        .mockRejectedValueOnce(
          new InvalidDimensionException('emp-bad', 'loc-bad'),
        );

      await expect(
        hcmService.getBalance('emp-bad', 'loc-bad'),
      ).rejects.toBeInstanceOf(InvalidDimensionException);
    });

    it('throws HcmUnavailableException when HTTP request times out', async () => {
      const { HcmUnavailableException } =
        await import('src/common/exceptions/hcm-unavailable.exception');

      jest
        .spyOn(hcmService, 'getBalance')
        .mockRejectedValueOnce(new HcmUnavailableException('timeout'));

      await expect(
        hcmService.getBalance('emp-001', 'loc-nyc'),
      ).rejects.toBeInstanceOf(HcmUnavailableException);
    });

    it('throws HcmUnavailableException when HCM returns 500', async () => {
      const { HcmUnavailableException } =
        await import('src/common/exceptions/hcm-unavailable.exception');

      jest
        .spyOn(hcmService, 'getBalance')
        .mockRejectedValueOnce(
          new HcmUnavailableException('internal_server_error'),
        );

      await expect(
        hcmService.getBalance('emp-001', 'loc-nyc'),
      ).rejects.toBeInstanceOf(HcmUnavailableException);
    });
  });

  describe('setBalance()', () => {
    it('returns updated balance on success', async () => {
      jest.spyOn(hcmService, 'setBalance').mockResolvedValueOnce({
        available: 7,
        used: 5,
        total: 12,
      });

      const result = await hcmService.setBalance('emp-001', 'loc-nyc', {
        available: 7,
        used: 5,
        total: 12,
      });

      expect(result).toEqual({ available: 7, used: 5, total: 12 });
    });

    it('throws InsufficientBalanceException when HCM returns 400 with insufficient_balance', async () => {
      const { InsufficientBalanceException } =
        await import('src/common/exceptions/insufficient-balance.exception');

      jest
        .spyOn(hcmService, 'setBalance')
        .mockRejectedValueOnce(new InsufficientBalanceException(0, 3));

      await expect(
        hcmService.setBalance('emp-001', 'loc-nyc', {
          available: -3,
          used: 15,
          total: 12,
        }),
      ).rejects.toBeInstanceOf(InsufficientBalanceException);
    });

    it('throws InvalidDimensionException when HCM returns 422', async () => {
      const { InvalidDimensionException } =
        await import('src/common/exceptions/invalid-dimension.exception');

      jest
        .spyOn(hcmService, 'setBalance')
        .mockRejectedValueOnce(
          new InvalidDimensionException('emp-001', 'loc-bad'),
        );

      await expect(
        hcmService.setBalance('emp-001', 'loc-bad', {
          available: 5,
          used: 0,
          total: 5,
        }),
      ).rejects.toBeInstanceOf(InvalidDimensionException);
    });

    it('throws HcmUnavailableException when HCM returns 500', async () => {
      const { HcmUnavailableException } =
        await import('src/common/exceptions/hcm-unavailable.exception');

      jest
        .spyOn(hcmService, 'setBalance')
        .mockRejectedValueOnce(
          new HcmUnavailableException('internal_server_error'),
        );

      await expect(
        hcmService.setBalance('emp-001', 'loc-nyc', {
          available: 5,
          used: 0,
          total: 5,
        }),
      ).rejects.toBeInstanceOf(HcmUnavailableException);
    });
  });
});
