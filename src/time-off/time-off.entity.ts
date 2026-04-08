import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TimeOffType, RequestStatus } from '../common/enums';

@Entity('time_off_request')
export class TimeOffRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column()
  startDate: string;

  @Column()
  endDate: string;

  @Column('float')
  daysRequested: number;

  @Column()
  type: TimeOffType;

  @Column({ default: RequestStatus.PENDING })
  status: RequestStatus;

  @Column({ nullable: true, type: 'text' })
  note: string | null;

  @Column({ nullable: true, type: 'text' })
  managerId: string | null;

  @Column({ nullable: true, type: 'text' })
  rejectionReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
