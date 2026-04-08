import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeOffRequestEntity } from './time-off.entity';
import { RequestStatus } from '../common/enums';

interface FindAllFilters {
  employeeId?: string;
  locationId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class TimeOffRepository {
  constructor(
    @InjectRepository(TimeOffRequestEntity)
    private readonly repo: Repository<TimeOffRequestEntity>,
  ) {}

  async create(data: Partial<TimeOffRequestEntity>): Promise<TimeOffRequestEntity> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<TimeOffRequestEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async update(id: string, data: Partial<TimeOffRequestEntity>): Promise<TimeOffRequestEntity> {
    await this.repo.update(id, data);
    return this.repo.findOne({ where: { id } }) as Promise<TimeOffRequestEntity>;
  }

  async findOverlapping(
    employeeId: string,
    locationId: string,
    startDate: string,
    endDate: string,
  ): Promise<TimeOffRequestEntity[]> {
    return this.repo
      .createQueryBuilder('tor')
      .where('tor.employeeId = :employeeId', { employeeId })
      .andWhere('tor.locationId = :locationId', { locationId })
      .andWhere('tor.status IN (:...statuses)', {
        statuses: [RequestStatus.PENDING, RequestStatus.APPROVED],
      })
      .andWhere('tor.startDate <= :endDate', { endDate })
      .andWhere('tor.endDate >= :startDate', { startDate })
      .getMany();
  }

  async findByFilters(filters: FindAllFilters): Promise<TimeOffRequestEntity[]> {
    const { employeeId, locationId, status, page = 1, limit = 20 } = filters;
    const qb = this.repo.createQueryBuilder('tor');
    if (employeeId) qb.andWhere('tor.employeeId = :employeeId', { employeeId });
    if (locationId) qb.andWhere('tor.locationId = :locationId', { locationId });
    if (status) qb.andWhere('tor.status = :status', { status });
    qb.skip((page - 1) * limit).take(limit);
    return qb.getMany();
  }

  async countByFilters(filters: Omit<FindAllFilters, 'page' | 'limit'>): Promise<number> {
    const { employeeId, locationId, status } = filters;
    const qb = this.repo.createQueryBuilder('tor');
    if (employeeId) qb.andWhere('tor.employeeId = :employeeId', { employeeId });
    if (locationId) qb.andWhere('tor.locationId = :locationId', { locationId });
    if (status) qb.andWhere('tor.status = :status', { status });
    return qb.getCount();
  }
}
