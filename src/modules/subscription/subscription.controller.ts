import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { ApiResult } from '../../common/interfaces/response.interface';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ExtendedRequest } from '../../common/interfaces/request.interface';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionService } from './subscription.service';
import Stripe from 'stripe';
import { ChangePlanDto } from './dto/change-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';

@ApiTags('stripe-subscriptions')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('stripe/subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new Stripe subscription for the authenticated user',
  })
  @ApiBody({
    type: CreateSubscriptionDto,
    description: 'Details of the subscription plan to create',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Subscription created or initiated successfully.',
    // Define the shape of the successful response data if needed, using the ApiResult structure
    // Consider creating a specific response DTO if you don't return the full Stripe object
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid input, payment method issue, or other creation error.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found.',
  })
  async createSubscription(
    @Req() request: ExtendedRequest,
    @Body() createSubscriptionDto: CreateSubscriptionDto,
  ): Promise<ApiResult<Stripe.Subscription>> {
    const user = request['authenticatedData'];
    const userId = user._id.toString();

    const stripeSubscription =
      await this.subscriptionService.createSubscription(
        userId,
        createSubscriptionDto,
      );

    // Determine appropriate success message based on status (optional refinement)
    let message = 'Subscription initiated successfully.';
    if (stripeSubscription.status === 'active') {
      message = 'Subscription created and active.';
    } else if (stripeSubscription.status === 'trialing') {
      message = 'Subscription created and trial started.';
    } else if (stripeSubscription.status === 'incomplete') {
      message =
        'Subscription initiated, but requires payment or further action.';
    }

    return {
      success: true,
      message: message,
      data: stripeSubscription,
    };
  }

  @Put('change-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Change (upgrade/downgrade) the authenticated user's active subscription plan",
  })
  @ApiBody({
    type: ChangePlanDto,
    description: 'Details of the new plan to switch to.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Subscription plan change initiated successfully. Check status for outcome.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid input, no active subscription, or other update error.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User or active subscription not found.',
  })
  async changePlan(
    @Req() request: ExtendedRequest,
    @Body() changePlanDto: ChangePlanDto,
  ): Promise<ApiResult<Stripe.Subscription>> {
    const user = request['authenticatedData'];
    const userId = user._id.toString();

    const updatedStripeSubscription =
      await this.subscriptionService.changeSubscriptionPlan(
        userId,
        changePlanDto,
      );

    let message = 'Subscription plan change initiated successfully.';
    if (updatedStripeSubscription.status === 'active') {
      message = 'Subscription plan updated and active.';
    } else if (updatedStripeSubscription.status === 'past_due') {
      message =
        'Subscription plan updated, but an immediate payment is past due.';
    }

    return {
      success: true,
      message: message,
      data: updatedStripeSubscription,
    };
  }

  @Get('current')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get the authenticated user's current subscription details",
  })
  @ApiQuery({
    name: 'sync',
    required: false,
    type: Boolean,
    description:
      'Whether to sync with Stripe for the latest data (default: false)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Subscription details retrieved successfully.',
    type: SubscriptionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Error retrieving subscription details.',
  })
  async getCurrentSubscription(
    @Req() request: ExtendedRequest,
    @Query('sync') sync?: string,
  ): Promise<ApiResult<SubscriptionResponseDto>> {
    const user = request['authenticatedData'];
    const userId = user._id.toString();
    const shouldSync = sync === 'true' || sync === '1';

    const subscriptionDetails =
      await this.subscriptionService.getUserSubscription(userId, shouldSync);

    let message = 'Subscription details retrieved successfully.';
    if (shouldSync) {
      message = 'Subscription details retrieved and synced with Stripe.';
    }

    return {
      success: true,
      message: message,
      data: subscriptionDetails,
    };
  }

  @Delete('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Cancel the authenticated user's active subscription (if any) immediately",
  })
  @ApiBody({
    type: CancelSubscriptionDto,
    description: 'Details of the cancellation request.',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Subscription cancellation initiated successfully. Check status for outcome.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid input, no active subscription, or other cancellation error.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User or active subscription not found.',
  })
  async cancelSubscription(
    @Req() request: ExtendedRequest,
    @Body() cancelSubscriptionDto: CancelSubscriptionDto = {},
  ): Promise<ApiResult<Stripe.Subscription>> {
    const user = request['authenticatedData'];
    const userId = user._id.toString();

    const cancelledSubscription =
      await this.subscriptionService.cancelSubscription(
        userId,
        cancelSubscriptionDto,
      );

    let message = 'Subscription cancelled successfully.';
    if (cancelSubscriptionDto.cancelImmediately) {
      message = 'Subscription cancelled immediately.';
    } else if (cancelledSubscription.cancel_at_period_end) {
      message =
        'Subscription will be cancelled at the end of the current billing period.';
    }

    return {
      success: true,
      message: message,
      data: cancelledSubscription,
    };
  }
}
