import { Global, Module } from '@nestjs/common';
import { CustomerModule } from './customer/customer.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { WebhookModule } from './webhook/webhook.module';

@Global()
@Module({
  imports: [CustomerModule, SubscriptionModule, WebhookModule],
  providers: [],
})
export class Modules {}
