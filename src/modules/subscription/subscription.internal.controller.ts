import { Controller, Get, Injectable, Param, UseGuards } from '@nestjs/common';
import { InternalGuard } from 'src/common/guards/internal.guard';
import { SubscriptionService } from './subscription.service';

@UseGuards(InternalGuard)
@Controller('api/internal/subscription')
export class InternalSubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

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
}
