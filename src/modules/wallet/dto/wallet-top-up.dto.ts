import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class WalletTopUpDto {
  @ApiProperty({
    description: 'The amount to top up the wallet',
    example: 100,
    required: true,
  })
  @IsInt({
    message: 'Amount must be an integer between 1 and 1000000',
  })
  @Min(1, {
    message: 'Amount should not be less than 1',
  })
  @Max(1000000, {
    message: 'Amount should not be greater than 1000000',
  })
  @IsNotEmpty()
  amount: number;

  @ApiProperty({
    description:
      'The Stripe Payment Method ID (required for the first paid subscription, obtained from frontend Stripe Elements/SDK)',
    example: 'pm_1P7kvL2eZvKYlo2C9GvA3B4C', // Example format
    required: false, // Optional, but crucial for initial paid subs
  })
  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;
}
