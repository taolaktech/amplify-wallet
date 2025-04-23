import {
  IsOptional,
  IsString,
  IsObject,
  ValidateNested,
  IsPhoneNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class AddressDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  line1?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  line2?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  city?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  state?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  postal_code?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  country?: string;
}

class ShippingDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  name?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  phone?: string;

  // Make address required in ShippingDto
  @ValidateNested()
  @Type(() => AddressDto)
  @ApiProperty({ type: AddressDto })
  address: AddressDto;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @IsPhoneNumber()
  @ApiProperty({ required: false, description: 'Customer phone number' })
  phone?: string;

  @IsOptional()
  @IsObject()
  @ApiProperty({ required: false, description: 'Customer metadata' })
  metadata?: Record<string, string>;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Default payment method ID' })
  defaultPaymentMethod?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  @ApiProperty({ required: false, type: AddressDto })
  address?: AddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingDto)
  @ApiProperty({ required: false, type: ShippingDto })
  shipping?: ShippingDto;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false, description: 'Customer description' })
  description?: string;
}
