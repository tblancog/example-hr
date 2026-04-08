import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('balance_sync_log')
export class SyncLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
