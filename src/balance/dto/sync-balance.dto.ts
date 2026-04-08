import { IsString, IsNotEmpty } from 'class-validator';

export class SyncBalanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;
}
