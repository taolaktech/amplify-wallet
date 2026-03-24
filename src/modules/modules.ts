import { Global, Module } from '@nestjs/common';
import { CustomerModule } from './customer/customer.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { WebhookModule } from './webhook/webhook.module';
import { WalletModule } from './wallet/wallet.module';
import { AppConfigModule } from './config/config.module';

@Global()
@Module({
  imports: [
    CustomerModule,
    SubscriptionModule,
    WebhookModule,
    WalletModule,
    AppConfigModule,
  ],
  providers: [],
})
export class Modules {}
