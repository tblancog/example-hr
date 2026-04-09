import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BalanceService } from '../balance/balance.service';
import { RequestStatus } from '../common/enums';
import { TimeOffRequestEntity } from './time-off.entity';

interface CreateDto {
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  type: string;
  note?: string;
}

interface FindAllFilters {
  employeeId?: string;
  locationId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

function computeDays(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

@Injectable()
export class TimeOffService {
  // Serializes concurrent create calls per employee+location to prevent race conditions
  private readonly createQueue = new Map<string, Promise<void>>();

  constructor(
    @Inject('TIME_OFF_REPOSITORY') private readonly timeOffRepository: any,
    private readonly balanceService: BalanceService,
  ) {}

  async create(dto: CreateDto): Promise<TimeOffRequestEntity> {
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    const key = `${dto.employeeId}:${dto.locationId}`;
    const current = this.createQueue.get(key) ?? Promise.resolve();
    let release!: () => void;
    this.createQueue.set(
      key,
      new Promise<void>((res) => {
        release = res;
      }),
    );

    try {
      await current;

      const overlapping = await this.timeOffRepository.findOverlapping(
        dto.employeeId,
        dto.locationId,
        dto.startDate,
        dto.endDate,
      );
      if (overlapping.length > 0) {
        throw new ConflictException(
          'A conflicting time-off request already exists for these dates',
        );
      }

      const daysRequested = computeDays(dto.startDate, dto.endDate);
      return await this.timeOffRepository.create({
        ...dto,
        daysRequested,
        status: RequestStatus.PENDING,
      });
    } finally {
      release();
    }
  }

  async approve(
    id: string,
    dto: { managerId: string },
  ): Promise<TimeOffRequestEntity> {
    const request = await this.timeOffRepository.findById(id);
    if (!request)
      throw new NotFoundException(`Time-off request ${id} not found`);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot approve a request with status ${request.status}`,
      );
    }

    await this.balanceService.checkAndDeductBalance(
      request.employeeId,
      request.locationId,
      request.daysRequested,
    );

    return this.timeOffRepository.update(id, {
      status: RequestStatus.APPROVED,
      managerId: dto.managerId,
    });
  }

  async reject(
    id: string,
    dto: { managerId: string; reason?: string },
  ): Promise<TimeOffRequestEntity> {
    const request = await this.timeOffRepository.findById(id);
    if (!request)
      throw new NotFoundException(`Time-off request ${id} not found`);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot reject a request with status ${request.status}`,
      );
    }

    return this.timeOffRepository.update(id, {
      status: RequestStatus.REJECTED,
      managerId: dto.managerId,
      rejectionReason: dto.reason ?? null,
    });
  }

  async cancel(id: string): Promise<TimeOffRequestEntity> {
    const request = await this.timeOffRepository.findById(id);
    if (!request)
      throw new NotFoundException(`Time-off request ${id} not found`);
    if (request.status !== RequestStatus.PENDING) {
      throw new ConflictException(
        `Cannot cancel a request with status ${request.status}`,
      );
    }

    return this.timeOffRepository.update(id, {
      status: RequestStatus.CANCELLED,
    });
  }

  async findById(id: string): Promise<TimeOffRequestEntity> {
    const request = await this.timeOffRepository.findById(id);
    if (!request)
      throw new NotFoundException(`Time-off request ${id} not found`);
    return request;
  }

  async findAll(filters: FindAllFilters): Promise<{
    data: TimeOffRequestEntity[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const [data, total] = await Promise.all([
      this.timeOffRepository.findByFilters(filters),
      this.timeOffRepository.countByFilters(filters),
    ]);
    return { data, total, page, limit };
  }
}
