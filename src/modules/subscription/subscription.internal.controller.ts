import { Controller, Get, Injectable, Param, UseGuards } from '@nestjs/common';
import { InternalGuard } from 'src/common/guards/internal.guard';
import { SubscriptionService } from './subscription.service';
import { AppConfigService } from '../config/config.service';

@UseGuards(InternalGuard)
@Controller('api/internal/subscription')
export class InternalSubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: AppConfigService,
  ) {}

  @Get('/subscription-details/:userId')
  async getUserSubscriptionPlan(@Param('userId') userId: string) {
    const subDetails = await this.subscriptionService.fetchSubDetails(userId);

    return {
      data: subDetails,
      message: 'Subscription details fetched successfully',
      success: true,
    };
  }

  // add an endpoint to get subscription configuration
  @Get('/subscription-configuration')
  async getSubscriptionConfiguration() {
    const config =
      await this.subscriptionService.getSubscriptionConfiguration();

    return {
      message: 'Subscription configuration fetched successfully',
      success: true,
      data: config,
    };
  }

  @Get('/subscription-tokens/:userId')
  async getUserSubscriptionTokens(@Param('userId') userId: string) {
    const subDetails = await this.subscriptionService.getUserSubscription(
      userId,
      false,
    );

    const activeStripePriceId = subDetails?.activeStripePriceId;
    const subscriptionStatus = subDetails?.subscriptionStatus;

    if (!activeStripePriceId) {
      return {
        data: {
          totalSubscriptionTokens: 0,
        },
        message: 'No active subscription priceId found for user',
        success: true,
      };
    }

    const { planTier, period } =
      this.configService.getPlanInfo(activeStripePriceId);

    const totalSubscriptionTokens =
      planTier !== 'unknown' && period !== 'unknown'
        ? this.configService.getSubscriptionTokens({
            planTier,
            period,
            isTrial: subscriptionStatus === 'trialing',
          })
        : 0;

    return {
      data: {
        totalSubscriptionTokens,
      },
      message: 'Subscription tokens fetched successfully',
      success: true,
    };
  }
}
