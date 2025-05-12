import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { ApiResult } from '../../common/interfaces/response.interface';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ExtendedRequest } from '../../common/interfaces/request.interface';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionService } from './subscription.service';
import Stripe from 'stripe';

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
}
