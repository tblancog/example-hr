import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientBalanceException extends HttpException {
  constructor(available: number, requested: number) {
    super(
      `Insufficient balance: ${available} available, ${requested} requested`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
