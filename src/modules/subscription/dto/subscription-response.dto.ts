import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty({ description: 'Stripe subscription ID' })
  stripeSubscriptionId: string | null;

  @ApiProperty({ description: 'Current subscription status' })
  subscriptionStatus: string | null;

  @ApiProperty({ description: 'Active Stripe price ID' })
  activeStripePriceId: string | null;

  @ApiProperty({ description: 'Current billing period end date' })
  currentPeriodEnd: Date | null;

  @ApiProperty({ description: 'Whether user has an active subscription' })
  hasActiveSubscription: boolean;

  @ApiProperty({ description: 'Current payment status' })
  paymentStatus: string;

  @ApiProperty({ description: 'Default payment method ID' })
  defaultPaymentMethod: string | null;

  @ApiProperty({ description: 'Last sync with Stripe' })
  lastStripeSync: Date | null;
}
