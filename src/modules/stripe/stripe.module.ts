import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Module({
  providers: [
    {
      provide: 'STRIPE_CLIENT',
      useFactory: (cfg: ConfigService) =>
        new Stripe(cfg.get('stripe.secretKey'), {
          apiVersion: '2025-03-31.basil',
        }),
      inject: [ConfigService],
    },
  ],
  exports: ['STRIPE_CLIENT'],
})
export class StripeModule {}
