import { Global, Module } from '@nestjs/common';
import { CustomerModule } from './customer/customer.module';
import { SubscriptionModule } from './subscription/subscription.module';

@Global()
@Module({
  imports: [CustomerModule, SubscriptionModule],
  providers: [],
})
export class Modules {}
