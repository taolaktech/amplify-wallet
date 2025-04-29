import { Global, Module } from '@nestjs/common';
import { CustomerModule } from './customer/customer.module';

@Global()
@Module({
  imports: [CustomerModule],
  providers: [],
})
export class Modules {}
