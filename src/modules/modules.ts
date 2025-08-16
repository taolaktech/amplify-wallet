import { Global, Module } from '@nestjs/common';
import { CustomerModule } from './customer/customer.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { WebhookModule } from './webhook/webhook.module';
import { WalletModule } from './wallet/wallet.module';

@Global()
@Module({
  imports: [CustomerModule, SubscriptionModule, WebhookModule, WalletModule],
  providers: [],
})
export class Modules {}
