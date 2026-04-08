import { IsString, IsNotEmpty, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchBalanceItemDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsString()
  @IsNotEmpty()
  locationId: string;

  @IsNumber()
  available: number;

  @IsNumber()
  used: number;

  @IsNumber()
  total: number;
}

export class BatchSyncDto {
  @IsString()
  @IsNotEmpty()
  syncId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceItemDto)
  balances: BatchBalanceItemDto[];
}
