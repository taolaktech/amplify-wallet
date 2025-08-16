import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';
// import { UserDocument } from '../../../common/interfaces/request.interface';
import { User } from '../../../database/schema';

export class CreateCustomerDto extends PartialType(User) {
  @ApiProperty({
    description: 'The address of the customer',
    example: {
      line1: '123 Main St',
      city: 'Anytown',
      state: 'CA',
      postal_code: '12345',
      country: 'US',
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;

  @ApiProperty({
    description: 'The name of the card holder',
    example: 'John Doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  cardHolderName?: string;
}
