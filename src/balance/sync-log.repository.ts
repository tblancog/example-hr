import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncLogEntity } from './sync-log.entity';

@Injectable()
export class SyncLogRepository {
  constructor(@InjectRepository(SyncLogEntity) private readonly repo: Repository<SyncLogEntity>) {}

  async insert(data: Partial<SyncLogEntity>): Promise<void> {
    await this.repo.save(this.repo.create(data));
  }

  async findBySyncId(syncId: string): Promise<SyncLogEntity | null> {
    return this.repo.findOne({ where: { syncId } });
  }
}
