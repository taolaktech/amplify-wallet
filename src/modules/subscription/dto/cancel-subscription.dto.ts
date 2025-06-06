import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsString } from 'class-validator';

export class CancelSubscriptionDto {
  @ApiProperty({
    description:
      'Whether to cancel immediately or at the end of the current period',
    default: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  cancelImmediately?: boolean = false;

  @ApiProperty({
    description: 'Optional reason for cancellation (for internal tracking)',
    required: false,
  })
  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
