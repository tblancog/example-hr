import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('balance')
@Unique(['employeeId', 'locationId'])
export class BalanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('float')
  available: number;

  @Column('float')
  used: number;

  @Column('float')
  total: number;

  @Column()
  source: string;

  @Column({ type: 'datetime' })
  lastSyncedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
