import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';


export enum ProrationBehavior {
  CREATE_PRORATIONS = 'create_prorations',
  NONE = 'none',
  ALWAYS_INVOICE = 'always_invoice',
}

export class ChangePlanDto {
  @ApiProperty({
    description: 'The Stripe Price ID for the new desired subscription plan (e.g., price_grow_monthly).',
    example: 'price_grow_monthly_actual_id', // Replace with an actual example Price ID
  })
  @IsString()
  @IsNotEmpty()
  newPriceId: string;

  @ApiProperty({
    description: "Determines how to handle prorations when switching plans. Defaults to 'create_prorations'.",
    example: ProrationBehavior.CREATE_PRORATIONS,
    enum: ProrationBehavior,
    required: false,
  })
  @IsOptional()
  @IsEnum(ProrationBehavior)
  prorationBehavior?: ProrationBehavior = ProrationBehavior.CREATE_PRORATIONS; // Default value
}