import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { TimeOffService } from './time-off.service';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { ApproveDto } from './dto/approve.dto';
import { RejectDto } from './dto/reject.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('time-off-requests')
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTimeOffRequestDto) {
    return this.timeOffService.create(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.timeOffService.findById(id);
  }

  @Get()
  findAll(
    @Query('employeeId') employeeId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.timeOffService.findAll({
      employeeId,
      locationId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // In production, add @UseGuards(RolesGuard) @Roles('MANAGER') here.
  // The RolesGuard reads X-User-Id / X-User-Role headers injected by the API
  // gateway after JWT verification. For this take-home the gateway trust model
  // is assumed; self-approval is still blocked at the service layer.
  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveDto) {
    return this.timeOffService.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.timeOffService.reject(id, {
      managerId: dto.managerId,
      reason: dto.reason,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@Param('id') id: string) {
    return this.timeOffService.cancel(id);
  }
}
