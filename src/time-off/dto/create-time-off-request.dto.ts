import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { TimeOffType } from '../../common/enums';

export class CreateTimeOffRequestDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsEnum(TimeOffType)
  type: TimeOffType;

  @IsOptional()
  @IsString()
  note?: string;
}
