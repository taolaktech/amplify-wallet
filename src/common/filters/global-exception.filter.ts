import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong';
    let errors = null;

    // Handle HttpExceptions (including BadRequestException which is used for validation errors)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Check if this is a validation error (typically comes as UnprocessableEntityException)
      if (
        exception instanceof UnprocessableEntityException &&
        typeof exceptionResponse === 'object' &&
        'errors' in exceptionResponse
      ) {
        // This is a validation error, preserve the detailed errors
        message = (exceptionResponse as any).message || 'Validation failed';
        errors = (exceptionResponse as any).errors;
      } else if (typeof exceptionResponse === 'object') {
        // Handle other HttpExceptions with object responses
        message = (exceptionResponse as any).message || exception.message;
        // Preserve any other fields in the exception response
        errors = (exceptionResponse as any).errors;
      } else {
        // Handle HttpExceptions with string responses
        message = exceptionResponse as string;
      }
    }

    // log the error
    this.logger.error(exception);

    // Prepare the error response
    const errorResponse: any = {
      success: false,
      statusCode: status,
      message: message,
      timestamp: new Date().toISOString(),
    };

    // Include detailed validation errors if available
    if (errors) {
      errorResponse.errors = errors;
    }

    response.status(status).json(errorResponse);
  }
}
