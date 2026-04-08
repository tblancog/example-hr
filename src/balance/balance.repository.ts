import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BalanceEntity } from './balance.entity';
import { RequestStatus } from '../common/enums';

@Injectable()
export class BalanceRepository {
  constructor(
    @InjectRepository(BalanceEntity) private readonly repo: Repository<BalanceEntity>,
    private readonly entityManager: EntityManager,
  ) {}

  async findByEmployeeLocation(employeeId: string, locationId: string): Promise<BalanceEntity | null> {
    return this.repo.findOne({ where: { employeeId, locationId } });
  }

  async upsert(data: Partial<BalanceEntity>): Promise<void> {
    const existing = await this.repo.findOne({
      where: { employeeId: data.employeeId, locationId: data.locationId },
    });
    if (existing) {
      Object.assign(existing, data);
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create(data));
    }
  }

  async findPendingDaysForEmployeeLocation(employeeId: string, locationId: string): Promise<number> {
    const result = await this.entityManager
      .createQueryBuilder()
      .select('COALESCE(SUM(tor.daysRequested), 0)', 'total')
      .from('time_off_request', 'tor')
      .where('tor.employeeId = :employeeId', { employeeId })
      .andWhere('tor.locationId = :locationId', { locationId })
      .andWhere('tor.status = :status', { status: RequestStatus.PENDING })
      .getRawOne();
    return parseFloat(result?.total ?? '0');
  }
}
