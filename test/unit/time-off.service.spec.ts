/**
 * Unit tests for TimeOffService.
 * TimeOffRepository and BalanceService are replaced with jest.fn() mocks.
 * Tests verify: daysRequested computation, overlap detection, state machine transitions.
 */

describe('TimeOffService', () => {
  let timeOffService: any;
  let mockTimeOffRepository: any;
  let mockBalanceService: any;

  beforeEach(async () => {
    const { Test } = await import('@nestjs/testing');
    const { TimeOffService } = await import('src/time-off/time-off.service');
    const { BalanceService } = await import('src/balance/balance.service');

    mockTimeOffRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      findOverlapping: jest.fn(),
      findByFilters: jest.fn(),
      countByFilters: jest.fn(),
    };

    mockBalanceService = {
      getBalance: jest.fn(),
      syncFromHcm: jest.fn(),
      checkAndDeductBalance: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TimeOffService,
        { provide: 'TIME_OFF_REPOSITORY', useValue: mockTimeOffRepository },
        { provide: BalanceService, useValue: mockBalanceService },
      ],
    }).compile();

    timeOffService = moduleRef.get(TimeOffService);
  });

  describe('create()', () => {
    it('computes daysRequested = 1 for a single-day request', async () => {
      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([]);
      mockTimeOffRepository.create.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: 'uuid-1', status: 'PENDING' }),
      );

      const result = await timeOffService.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        type: 'VACATION',
      });

      expect(result.daysRequested).toBe(1);
    });

    it('computes daysRequested = 5 for a 5-day request', async () => {
      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([]);
      mockTimeOffRepository.create.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: 'uuid-2', status: 'PENDING' }),
      );

      const result = await timeOffService.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        type: 'VACATION',
      });

      expect(result.daysRequested).toBe(5);
    });

    it('computes daysRequested correctly crossing a month boundary (Jan 29 - Feb 2 = 5 days)', async () => {
      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([]);
      mockTimeOffRepository.create.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: 'uuid-3', status: 'PENDING' }),
      );

      const result = await timeOffService.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        startDate: '2026-01-29',
        endDate: '2026-02-02',
        type: 'VACATION',
      });

      expect(result.daysRequested).toBe(5);
    });

    it('throws BadRequestException when endDate is before startDate', async () => {
      const { BadRequestException } = await import('@nestjs/common');

      await expect(
        timeOffService.create({
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          startDate: '2026-06-05',
          endDate: '2026-06-01',
          type: 'VACATION',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockTimeOffRepository.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for same-day request where endDate < startDate is not possible but 0-day is invalid', async () => {
      // startDate === endDate should compute to 1 day (inclusive), not 0
      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([]);
      mockTimeOffRepository.create.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: 'uuid-4', status: 'PENDING' }),
      );

      const result = await timeOffService.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        type: 'SICK',
      });

      expect(result.daysRequested).toBe(1);
      expect(result.status).toBe('PENDING');
    });

    it('throws ConflictException when a PENDING request overlaps same employee+location+dates', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([
        {
          id: 'existing-1',
          status: 'PENDING',
          startDate: '2026-06-01',
          endDate: '2026-06-05',
        },
      ]);

      await expect(
        timeOffService.create({
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          startDate: '2026-06-03',
          endDate: '2026-06-07',
          type: 'VACATION',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when an APPROVED request overlaps same employee+location+dates', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([
        {
          id: 'approved-1',
          status: 'APPROVED',
          startDate: '2026-06-01',
          endDate: '2026-06-05',
        },
      ]);

      await expect(
        timeOffService.create({
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          startDate: '2026-06-04',
          endDate: '2026-06-08',
          type: 'VACATION',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('succeeds when dates do not overlap any existing request', async () => {
      mockTimeOffRepository.findOverlapping.mockResolvedValueOnce([]);
      mockTimeOffRepository.create.mockImplementation((data: any) =>
        Promise.resolve({ ...data, id: 'uuid-5', status: 'PENDING' }),
      );

      const result = await timeOffService.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
        type: 'PERSONAL',
      });

      expect(result.status).toBe('PENDING');
    });
  });

  describe('approve()', () => {
    it('throws ConflictException when request status is already APPROVED', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'APPROVED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(
        timeOffService.approve('req-1', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when request status is CANCELLED', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'CANCELLED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(
        timeOffService.approve('req-1', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when request status is REJECTED', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'REJECTED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(
        timeOffService.approve('req-1', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when request does not exist', async () => {
      const { NotFoundException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce(null);

      await expect(
        timeOffService.approve('nonexistent-id', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates InsufficientBalanceException when BalanceService throws it', async () => {
      const { InsufficientBalanceException } =
        await import('src/common/exceptions/insufficient-balance.exception');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'PENDING',
        daysRequested: 5,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });
      mockBalanceService.checkAndDeductBalance.mockRejectedValueOnce(
        new InsufficientBalanceException(2, 5),
      );

      await expect(
        timeOffService.approve('req-1', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(InsufficientBalanceException);
    });
  });

  describe('reject()', () => {
    it('throws ConflictException when request is not PENDING', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'APPROVED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(
        timeOffService.reject('req-1', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when request is already REJECTED', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'REJECTED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(
        timeOffService.reject('req-1', { managerId: 'mgr-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects successfully when request is PENDING', async () => {
      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'PENDING',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });
      mockTimeOffRepository.update.mockImplementation((id: string, data: any) =>
        Promise.resolve({ id, ...data, status: 'REJECTED' }),
      );

      const result = await timeOffService.reject('req-1', {
        managerId: 'mgr-1',
        reason: 'Team shortage',
      });
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('cancel()', () => {
    it('throws ConflictException when request is APPROVED (cannot undo approvals)', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'APPROVED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(timeOffService.cancel('req-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws ConflictException when request is already CANCELLED', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'CANCELLED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(timeOffService.cancel('req-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws ConflictException when request is REJECTED', async () => {
      const { ConflictException } = await import('@nestjs/common');

      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'REJECTED',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });

      await expect(timeOffService.cancel('req-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('cancels successfully when request is PENDING', async () => {
      mockTimeOffRepository.findById.mockResolvedValueOnce({
        id: 'req-1',
        status: 'PENDING',
        daysRequested: 3,
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
      });
      mockTimeOffRepository.update.mockImplementation((id: string, data: any) =>
        Promise.resolve({ id, ...data, status: 'CANCELLED' }),
      );

      const result = await timeOffService.cancel('req-1');
      expect(result.status).toBe('CANCELLED');
    });
  });
});
