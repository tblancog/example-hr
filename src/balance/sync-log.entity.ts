import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('balance_sync_log')
export class SyncLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // syncId is the batch identifier — multiple rows per batch share the same value.
  // Cross-instance idempotency relies on the in-memory Set in BalanceService
  // (same-process guard) plus operational discipline. A production fix would use
  // a separate ProcessedSyncIds table with a unique index on syncId.
  @Column({ nullable: true })
  syncId: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('float', { nullable: true })
  previousAvailable: number;

  @Column('float')
  newAvailable: number;

  @Column()
  trigger: string;

  @Column({ nullable: true })
  conflictNotes: string;

  @CreateDateColumn()
  createdAt: Date;
}
