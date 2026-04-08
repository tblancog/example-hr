import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RejectDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
