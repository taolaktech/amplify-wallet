import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class DebitCampaignDto {
  @ApiProperty({
    description: 'The ID of the user to debit',
    example: '9182000182fedc',
    required: true,
  })
  @IsNotEmpty({
    message: 'User ID must not be empty',
  })
  @IsString({
    message: 'User ID must be a string',
  })
  userId: string;

  @Min(1, {
    message: 'Amount must be greater than or equal to 1',
  })
  @Max(1000000, {
    message: 'Amount must be less than or equal to 1,000,000',
  })
  amountInCents: number;

  // @IsNotEmpty({
  //   message: 'Idempotency key must not be empty',
  // })
  // @IsString({
  //   message: 'Idempotency key must be a string',
  // })
  // idempotencyKey: string;
}
