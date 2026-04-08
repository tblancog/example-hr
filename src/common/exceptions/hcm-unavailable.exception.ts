import { HttpException, HttpStatus } from '@nestjs/common';

export class HcmUnavailableException extends HttpException {
  constructor(reason: string) {
    super(`HCM service unavailable: ${reason}`, HttpStatus.BAD_GATEWAY);
  }
}
