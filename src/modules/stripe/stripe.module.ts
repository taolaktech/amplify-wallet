import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Module({
  providers: [
    {
      provide: 'STRIPE_CLIENT',
      useFactory: () => {
        return new Stripe(process.env.STRIPE_API_KEY, {
          apiVersion: '2025-03-31.basil',
        });
      },
    },
  ],
  exports: ['STRIPE_CLIENT'],
})
export class StripeModule {}