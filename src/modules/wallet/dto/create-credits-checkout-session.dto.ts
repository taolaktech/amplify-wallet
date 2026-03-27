import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateCreditsCheckoutSessionDto {
  @ApiPropertyOptional({
    description: 'Optional Stripe Price ID for the selected top-up pack',
    example: 'price_1TD8jZKiCBcQA15oKE5M5gzz',
  })
  @IsOptional()
  @IsString()
  priceId?: string;
}
