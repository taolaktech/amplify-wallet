import { ApiProperty } from '@nestjs/swagger';

export class ApiResult<T extends object> {
  @ApiProperty({
    description: 'Response data',
    // example: { id: 1, name: 'John Doe' },
    type: 'object',
    additionalProperties: true,
  })
  data: T;

  @ApiProperty({
    description: 'Response message',
    example: 'Operation completed successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Response status',
    example: 'success',
    type: 'boolean',
  })
  success: boolean;
}

export class ApiResponseList<T> {
  @ApiProperty({
    description: 'Response data',
    type: 'array',
  })
  data: T[];

  @ApiProperty({
    description: 'Response message',
    example: 'Operation completed successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Response status',
    example: 'success',
    enum: ['success', 'error'],
  })
  status: string;
}

export class PaginatedApiResponse<T> extends ApiResponseList<T> {
  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      total: 100,
      page: 1,
      perPage: 10,
      currentPage: 1,
    },
  })
  meta: {
    total: number;
    page: number;
    perPage: number;
    currentPage: number;
  };
}
