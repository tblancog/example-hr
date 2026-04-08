import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidDimensionException extends HttpException {
  constructor(employeeId: string, locationId: string) {
    super(
      `Invalid employee/location combination: ${employeeId}/${locationId}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
