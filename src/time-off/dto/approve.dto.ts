import { IsString, IsNotEmpty } from 'class-validator';

export class ApproveDto {
  @IsString()
  @IsNotEmpty()
  managerId: string;
}
