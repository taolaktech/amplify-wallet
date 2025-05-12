import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SetDefaultPaymentMethodDto {
  @ApiProperty({
    description: 'The Stripe PaymentMethod ID (pm_...) to set as default.',
  })
  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;
}
