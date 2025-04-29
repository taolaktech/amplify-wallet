import {
  ValidationPipe,
  BadRequestException,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ValidationError as ClassValidatorError } from 'class-validator';

export class ValidationError extends Error {
  constructor(
    public errors: Array<{
      property: string;
      constraints: string[];
    }>,
  ) {
    super('Validation Failed');
    this.name = 'ValidationError';
  }
}

export const validationConfig = new ValidationPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  // Strip away properties not defined in the DTO
  whitelist: true,

  // Throw error if unknown properties are present
  forbidNonWhitelisted: true,

  // Transform payload to DTO instance
  transform: true,

  // Custom error handling
  exceptionFactory: (errors: ClassValidatorError[]) => {
    const formattedErrors = errors.map((error) => ({
      property: error.property,
      constraints: error.constraints ? Object.values(error.constraints) : [],
    }));

    return new UnprocessableEntityException({
      message: 'Validation Failed',
      errors: formattedErrors,
    });
  },
});
