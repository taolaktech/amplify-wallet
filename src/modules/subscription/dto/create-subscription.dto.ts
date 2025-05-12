import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({
    description: 'The Stripe Price ID for the desired base subscription plan (e.g., price_starter_monthly)',
    example: 'price_starter_monthly',
  })
  @IsString()
  @IsNotEmpty()
  priceId: string;

  @ApiProperty({
    description: 'The Stripe Payment Method ID (required for the first paid subscription, obtained from frontend Stripe Elements/SDK)',
    example: 'pm_1P7kvL2eZvKYlo2C9GvA3B4C', // Example format
    required: false, // Optional, but crucial for initial paid subs
  })
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}