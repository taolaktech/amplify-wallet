import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CAMPAIGN_LIMIT,
  getPlanName,
  PlanName,
} from 'src/common/constants/price.constant';
import Stripe from 'stripe';
import { User, UserDoc } from '../../database/schema';
import { StripeCustomerService } from '../customer/customer.service';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { ChangePlanDto } from './dto/change-subscription.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel('users') private userModel: Model<UserDoc>,
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
    private readonly stripeCustomerService: StripeCustomerService,
  ) {}

  /**
   * Creates a Stripe subscription for a user.
   * @param userId The ID of the user in your local database.
   * @param createSubscriptionDto DTO containing the Price ID and optional Payment Method ID.
   * @returns The created Stripe Subscription object.
   */
  private async findAndValidateUser(userId: string): Promise<UserDoc> {
    const user = await this.userModel
      .findById(userId)
      .select('+stripeCustomerId')
      .exec();
    if (!user) {
      this.logger.error(`User not found with ID: ${userId}`);
      throw new NotFoundException(`User not found with ID: ${userId}`);
    }
    return user;
  }

  private async getOrCreateStripeCustomerId(user: UserDoc): Promise<string> {
    if (user.stripeCustomerId) {
      this.logger.log(
        `Found existing Stripe Customer ID: ${user.stripeCustomerId} for user ${user._id}`,
      );
      return user.stripeCustomerId;
    }

    this.logger.log(
      `No Stripe Customer ID found for user ${user._id}. Creating new Stripe Customer...`,
    );
    const newStripeCustomer =
      await this.stripeCustomerService.createStripeCustomer(user);
    this.logger.log(
      `Created new Stripe Customer ID: ${newStripeCustomer.id} for user ${user._id}`,
    );
    return newStripeCustomer.id;
  }

  private async handlePaymentMethod(
    paymentMethodId: string | undefined,
    stripeCustomerId: string,
    userId: string,
  ): Promise<void> {
    if (!paymentMethodId) {
      this.logger.log(
        `No new PaymentMethod ID provided for customer ${stripeCustomerId}. Using existing default if available.`,
      );
      return;
    }

    this.logger.log(
      `PaymentMethod ID ${paymentMethodId} provided. Attaching to customer ${stripeCustomerId}...`,
    );
    try {
      const attachedPaymentMethod = await this.stripe.paymentMethods.attach(
        paymentMethodId,
        { customer: stripeCustomerId },
      );

      const actualAttachedPmId = attachedPaymentMethod.id;
      this.logger.log(
        `Successfully attached PaymentMethod ${paymentMethodId} to ${actualAttachedPmId}`,
      );

      await this.stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: actualAttachedPmId },
      });
      this.logger.log(
        `Set PaymentMethod ${actualAttachedPmId} as default for ${stripeCustomerId}`,
      );

      await this.userModel.findByIdAndUpdate(userId, {
        defaultPaymentMethod: actualAttachedPmId,
        lastStripeSync: new Date(),
      });
      this.logger.log(
        `Updated local user ${userId} default payment method ID to ${actualAttachedPmId}.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to attach/set default PaymentMethod (Input ID: ${paymentMethodId}) for customer ${stripeCustomerId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Failed to set up payment method: ${error.message}`,
      );
    }
  }

  private createSubscriptionParams(
    stripeCustomerId: string,
    priceId: string,
    userId: string,
  ): Stripe.SubscriptionCreateParams {
    const subscriptionItems: Stripe.SubscriptionCreateParams.Item[] = [
      { price: priceId },
    ];

    return {
      customer: stripeCustomerId,
      items: subscriptionItems,
      expand: ['latest_invoice', 'pending_setup_intent'],
      collection_method: 'charge_automatically',
      metadata: { localUserId: userId },
    };
  }

  private async validatePaymentStatus(
    stripeSubscription: Stripe.Subscription,
  ): Promise<void> {
    const latestInvoice = stripeSubscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = latestInvoice?.last_finalization_error
      ?.payment_intent as Stripe.PaymentIntent;

    if (paymentIntent) {
      if (
        paymentIntent.status == 'requires_payment_method' ||
        paymentIntent.status == 'requires_action'
      ) {
        this.logger.error(
          `Initial payment for subscription ${stripeSubscription.id} requires action or failed. Status: ${paymentIntent.status}`,
        );
        throw new BadRequestException(
          `Payment required or needs further action. Status: ${paymentIntent.status}`,
        );
      }
    } else if (stripeSubscription.status === 'incomplete') {
      this.logger.warn(
        `Subscription ${stripeSubscription.id} created with status 'incomplete'. Payment may be required.`,
      );
      throw new BadRequestException({
        message:
          'Subscription created but payment is incomplete. Please check payment details.',
        code: 'incomplete_payment',
        subscriptionId: stripeSubscription.id,
      });
    }
  }

  private async updateLocalUserSubscription(
    userId: string,
    stripeSubscription: Stripe.Subscription,
    priceId: string,
  ): Promise<void> {
    const updateData: Partial<User> = {
      stripeSubscriptionId: stripeSubscription.id,
      subscriptionStatus: stripeSubscription.status,
      paymentStatus:
        stripeSubscription.status === 'past_due'
          ? 'past_due'
          : stripeSubscription.status === 'active' ||
              stripeSubscription.status === 'trialing'
            ? 'active'
            : 'none',
      activeStripePriceId: priceId,
      currentPeriodEnd: new Date(
        stripeSubscription?.items?.data[0].current_period_end * 1000,
      ),
      hasActiveSubscription: ['active', 'trialing'].includes(
        stripeSubscription.status,
      ),
      lastStripeSync: new Date(),
      planTier: getPlanName(priceId),
    };

    this.logger.log(
      `Updating local user ${userId} with subscription data: ${JSON.stringify(updateData)}`,
    );
    await this.userModel.findByIdAndUpdate(userId, updateData);
    this.logger.log(`Successfully updated user ${userId} in local database.`);
  }

  async createSubscription(
    userId: string,
    createSubscriptionDto: CreateSubscriptionDto,
  ): Promise<Stripe.Subscription> {
    const { priceId, paymentMethodId } = createSubscriptionDto;
    this.logger.log(
      `Attempting to create subscription for user ${userId} with price ${priceId}`,
    );

    try {
      const user = await this.findAndValidateUser(userId);
      const stripeCustomerId = await this.getOrCreateStripeCustomerId(user);
      await this.handlePaymentMethod(paymentMethodId, stripeCustomerId, userId);

      const subscriptionParams = this.createSubscriptionParams(
        stripeCustomerId,
        priceId,
        userId,
      );

      this.logger.log(
        `Creating Stripe subscription for customer ${stripeCustomerId}...`,
      );
      const stripeSubscription =
        await this.stripe.subscriptions.create(subscriptionParams);
      this.logger.log(
        `Successfully created Stripe subscription ${stripeSubscription.id}`,
      );

      await this.validatePaymentStatus(stripeSubscription);
      await this.updateLocalUserSubscription(
        userId,
        stripeSubscription,
        priceId,
      );

      return stripeSubscription;
    } catch (error) {
      this.logger.error(
        `Failed to create subscription for user ${userId}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        `Could not create subscription: ${error.message}`,
      );
    }
  }

  /**
   * Changes an existing subscription to a new plan.
   * @param userId The ID of the user in your local database.
   * @param changePlanDto DTO containing the new Price ID and proration behavior.
   * @returns The updated Stripe Subscription object.
   */
  async changeSubscriptionPlan(
    userId: string,
    changePlanDto: ChangePlanDto,
  ): Promise<Stripe.Subscription> {
    const { newPriceId, prorationBehavior } = changePlanDto;

    this.logger.log(
      `Attempting to change subscription for user ${userId} to new price ${newPriceId} with proration ${prorationBehavior}`,
    );

    try {
      // 1. Find the user and their current active Stripe Subscription ID from your DB
      const user = await this.userModel
        .findById(userId)
        .select('stripeCustomerId stripeSubscriptionId activeStripePriceId') // Select necessary fields
        .exec();

      if (!user) {
        this.logger.error(`User not found with ID: ${userId} for plan change.`);
        throw new NotFoundException(`User not found with ID: ${userId}.`);
      }

      if (!user.stripeSubscriptionId) {
        this.logger.warn(
          `User ${userId} does not have an active Stripe subscription to change.`,
        );
        throw new BadRequestException(
          'No active subscription found to change.',
        );
      }

      if (!user.stripeCustomerId) {
        this.logger.error(
          `User ${userId} has a subscription ID but no Stripe Customer ID. Data inconsistency.`,
        );
        throw new BadRequestException('Customer configuration error.');
      }

      if (user.activeStripePriceId === newPriceId) {
        this.logger.warn(
          `User ${userId} is already subscribed to price ${newPriceId}. No change needed.`,
        );
        // Retrieve and return the current subscription as no change is made
        return this.stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      }

      // 2. Retrieve the current subscription from Stripe to get its items
      let currentSubscription: Stripe.Subscription;
      try {
        currentSubscription = await this.stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
          { expand: ['items', 'schedule'] }, // Expand items and schedule
        );
      } catch (error) {
        this.logger.error(
          `Failed to retrieve current subscription ${user.stripeSubscriptionId} from Stripe: ${error.message}`,
          error.stack,
        );
        if (error.code === 'resource_missing') {
          await this.userModel.findByIdAndUpdate(userId, {
            stripeSubscriptionId: null,
            activeStripePriceId: null,
            subscriptionStatus: 'canceled',
            hasActiveSubscription: false,
          });
          throw new NotFoundException(
            'Active subscription not found in Stripe. Please subscribe first.',
          );
        }
        throw new BadRequestException(
          `Could not retrieve current subscription details: ${error.message}`,
        );
      }

      if (
        !currentSubscription.items ||
        currentSubscription.items.data.length === 0
      ) {
        this.logger.error(
          `Subscription ${user.stripeSubscriptionId} has no items. Cannot update.`,
        );
        throw new BadRequestException(
          'Current subscription has no items to update.',
        );
      }

      const currentSubscriptionItemId = currentSubscription.items.data[0].id;
      if (!currentSubscriptionItemId) {
        throw new BadRequestException(
          'Cannot identify the current subscription item to update.',
        );
      }

      // DOWNGRADE LOGIC (Schedule)
      if (prorationBehavior === 'none') {
        this.logger.log(
          `Downgrade detected (proration: none). Scheduling change for end of period.`,
        );

        let scheduleId: string;

        // Check if a schedule already exists
        if (currentSubscription.schedule) {
          scheduleId =
            typeof currentSubscription.schedule === 'string'
              ? currentSubscription.schedule
              : currentSubscription.schedule.id;
          this.logger.log(`Using existing schedule ${scheduleId}`);
        } else {
          // Create a new schedule from the existing subscription
          this.logger.log(
            `Creating new schedule from subscription ${user.stripeSubscriptionId}`,
          );
          const schedule = await this.stripe.subscriptionSchedules.create({
            from_subscription: user.stripeSubscriptionId,
          });
          scheduleId = schedule.id;
        }

        // Update the schedule to switch to the new price at the end of the current period
        // We define phases:
        // Phase 1: Current Plan (runs until current_period_end) - Stripe handles this with 'from_subscription' or existing phases
        // Phase 2: New Plan (starts at current_period_end)
        
        // Note: When updating phases, we must be careful. 
        // If we just created it from subscription, it has one phase.
        // We want to append a phase or ensure the next phase is our new price.
        
        // A robust way is to update the schedule with the new phases configuration.
        // We need to know the current phase end date (which is current_period_end).
        
        await this.stripe.subscriptionSchedules.update(scheduleId, {
          end_behavior: 'release',
          phases: [
            {
              items: [
                {
                  price: currentSubscription.items.data[0].price.id,
                  quantity: currentSubscription.items.data[0].quantity,
                },
              ],
              start_date: 'now', // Updates the current phase
              end_date: currentSubscription.items.data[0].current_period_end, // Ends at the billing cycle
            },
            {
              items: [
                {
                  price: newPriceId,
                },
              ],
              start_date: currentSubscription.items.data[0].current_period_end, // Starts when the previous one ends
            },
          ],
        });

        this.logger.log(
          `Successfully scheduled downgrade to ${newPriceId} for end of period on schedule ${scheduleId}`,
        );

        // We return the subscription. It won't show the new price yet.
        // We might want to update the local DB to indicate a "pending change" if we had a field for it,
        // but for now we just leave it as is (Active on Old Plan).
        return this.stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      }

      // UPGRADE / IMMEDIATE CHANGE LOGIC (Standard)
      
      // 3. Prepare parameters for updating the subscription
      const updateParams: Stripe.SubscriptionUpdateParams = {
        items: [
          {
            id: currentSubscriptionItemId, // The ID of the subscription item to modify
            price: newPriceId, // The ID of the new price
          },
        ],
        proration_behavior: prorationBehavior,
        expand: ['latest_invoice', 'pending_setup_intent'],
      };

      // 4. Call Stripe to update the subscription
      this.logger.log(
        `Updating Stripe subscription ${user.stripeSubscriptionId} to price ${newPriceId}...`,
      );
      const updatedStripeSubscription = await this.stripe.subscriptions.update(
        user.stripeSubscriptionId,
        updateParams,
      );
      this.logger.log(
        `Successfully updated Stripe subscription ${updatedStripeSubscription.id}. New status: ${updatedStripeSubscription.status}`,
      );

      //  Handle Initial Payment Status for Prorations (Similar to createSubscription)
      //    If an upgrade causes an immediate proration charge.
      // const latestInvoice = updatedStripeSubscription.latest_invoice as Stripe.Invoice;

      // Update local database (minimal update here; rely on webhooks for final state)
      //    The `customer.subscription.updated` webhook is the most reliable source for updating
      //    activeStripePriceId, currentPeriodEnd, and subscriptionStatus.
      //    Here, we mainly log and acknowledge.
      await this.userModel.findByIdAndUpdate(userId, {
        lastStripeSync: new Date(),
      });
      this.logger.log(
        `Local user ${userId} lastStripeSync updated after plan change request.`,
      );

      return updatedStripeSubscription;
    } catch (error) {
      this.logger.error(
        `Failed to change subscription for user ${userId} to price ${newPriceId}: ${error.message}`,
        error.stack,
      );
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException(
        `Could not change subscription: ${error.message}`,
      );
    }
  }

  /**
   * Retrieves the current user's subscription details from the database
   * and optionally syncs with Stripe for the most up-to-date information.
   * @param userId The ID of the user in your local database.
   * @param syncWithStripe Whether to fetch fresh data from Stripe (optional, defaults to false)
   * @returns The user's subscription details
   */
  async getUserSubscription(
    userId: string,
    syncWithStripe: boolean = false,
  ): Promise<SubscriptionResponseDto> {
    this.logger.log(
      `Fetching subscription details for user ${userId}${syncWithStripe ? ' with Stripe sync' : ''}`,
    );

    try {
      const user = await this.findAndValidateUser(userId);

      // If sync is requested and user has a Stripe subscription, fetch latest from Stripe
      if (syncWithStripe && user.stripeSubscriptionId) {
        await this.syncSubscriptionWithStripe(user);
        // Refetch user data after sync
        const updatedUser = await this.findAndValidateUser(userId);
        return this.mapUserToSubscriptionResponse(updatedUser);
      }

      return this.mapUserToSubscriptionResponse(user);
    } catch (error) {
      this.logger.error(
        `Failed to fetch subscription for user ${userId}: ${error.message}`,
        error.stack,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        `Could not fetch subscription details: ${error.message}`,
      );
    }
  }

  /**
   * Syncs the user's subscription data with Stripe to ensure accuracy
   * @param user The user document
   * @private
   */
  private async syncSubscriptionWithStripe(user: UserDoc): Promise<void> {
    if (!user.stripeSubscriptionId) {
      this.logger.warn(
        `User ${user._id} has no Stripe subscription ID to sync with`,
      );
      return;
    }

    try {
      this.logger.log(
        `Syncing subscription ${user.stripeSubscriptionId} with Stripe for user ${user._id}`,
      );

      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
      );

      const updateData = {
        subscriptionStatus: stripeSubscription.status,
        activeStripePriceId:
          stripeSubscription.items &&
          stripeSubscription.items.data &&
          stripeSubscription.items.data.length > 0 &&
          stripeSubscription.items.data[0].price
            ? stripeSubscription.items.data[0].price.id
            : user.activeStripePriceId,
        currentPeriodEnd: new Date(
          stripeSubscription?.items?.data[0]?.current_period_end * 1000,
        ),
        hasActiveSubscription: ['active', 'trialing'].includes(
          stripeSubscription.status,
        ),
        paymentStatus:
          stripeSubscription.status === 'past_due'
            ? 'past_due'
            : stripeSubscription.status === 'unpaid'
              ? 'past_due'
              : ['active', 'trialing'].includes(stripeSubscription.status)
                ? 'active'
                : stripeSubscription.status === 'canceled'
                  ? 'canceled'
                  : 'none',
        lastStripeSync: new Date(),
      };

      await this.userModel.findByIdAndUpdate(user._id, updateData);
      this.logger.log(
        `Successfully synced subscription data for user ${user._id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to sync subscription with Stripe for user ${user._id}: ${error.message}`,
        error.stack,
      );

      if (error.code === 'resource_missing') {
        // Subscription no longer exists in Stripe, update local data
        await this.userModel.findByIdAndUpdate(user._id, {
          stripeSubscriptionId: null,
          subscriptionStatus: 'canceled',
          activeStripePriceId: null,
          hasActiveSubscription: false,
          paymentStatus: 'canceled',
          lastStripeSync: new Date(),
        });
        this.logger.log(
          `Cleared subscription data for user ${user._id} as it no longer exists in Stripe`,
        );
      } else {
        // Don't throw error for sync failures, just log and continue with cached data
        this.logger.warn(
          `Sync failed for user ${user._id}, returning cached subscription data`,
        );
      }
    }
  }

  /**
   * Maps user document to subscription response DTO
   * @param user The user document
   * @returns Formatted subscription response
   * @private
   */
  private mapUserToSubscriptionResponse(
    user: UserDoc,
  ): SubscriptionResponseDto {
    return {
      stripeSubscriptionId: user.stripeSubscriptionId || null,
      subscriptionStatus: user.subscriptionStatus || null,
      activeStripePriceId: user.activeStripePriceId || null,
      currentPeriodEnd: user.currentPeriodEnd || null,
      hasActiveSubscription: user.hasActiveSubscription || false,
      paymentStatus: user.paymentStatus || 'none',
      defaultPaymentMethod: user.defaultPaymentMethod || null,
      lastStripeSync: user.lastStripeSync || null,
    };
  }

  /**
   * Cancels a user's active subscription.
   * @param userId The ID of the user in your local database.
   * @param cancelSubscriptionDto DTO containing cancellation preferences.
   * @returns The cancelled Stripe Subscription object.
   */
  async cancelSubscription(
    userId: string,
    cancelSubscriptionDto: CancelSubscriptionDto,
  ): Promise<Stripe.Subscription> {
    const { cancelImmediately, cancellationReason } = cancelSubscriptionDto;

    this.logger.log(
      `Attempting to cancel subscription for user ${userId}. Immediate: ${cancelImmediately}, Reason: ${cancellationReason || 'Not provided'}`,
    );

    try {
      // 1. Find the user and validate they have an active subscription
      const user = await this.userModel
        .findById(userId)
        .select(
          'stripeCustomerId stripeSubscriptionId subscriptionStatus hasActiveSubscription',
        )
        .exec();

      if (!user) {
        this.logger.error(
          `User not found with ID: ${userId} for subscription cancellation.`,
        );
        throw new NotFoundException(`User not found with ID: ${userId}.`);
      }

      if (!user.stripeSubscriptionId) {
        this.logger.warn(
          `User ${userId} does not have an active Stripe subscription to cancel.`,
        );
        throw new BadRequestException(
          'No active subscription found to cancel.',
        );
      }

      if (!user.stripeCustomerId) {
        this.logger.error(
          `User ${userId} has a subscription ID but no Stripe Customer ID. Data inconsistency.`,
        );
        throw new BadRequestException('Customer configuration error.');
      }

      // 2. Verify the subscription exists in Stripe and get current status
      let currentSubscription: Stripe.Subscription;
      try {
        currentSubscription = await this.stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
        );
      } catch (error) {
        this.logger.error(
          `Failed to retrieve subscription ${user.stripeSubscriptionId} from Stripe: ${error.message}`,
          error.stack,
        );

        if (error.code === 'resource_missing') {
          // Subscription doesn't exist in Stripe, clean up local data
          await this.clearLocalSubscriptionData(userId);
          throw new NotFoundException(
            'Subscription not found in Stripe. Local data has been cleaned up.',
          );
        }
        throw new BadRequestException(
          `Could not retrieve subscription details: ${error.message}`,
        );
      }

      // 3. Check if subscription is already cancelled
      if (currentSubscription.status === 'canceled') {
        this.logger.warn(
          `Subscription ${user.stripeSubscriptionId} is already cancelled.`,
        );
        throw new BadRequestException('Subscription is already cancelled.');
      }

      // 4. Prepare cancellation parameters
      const cancelParams:
        | Stripe.SubscriptionUpdateParams
        | Stripe.SubscriptionCancelParams = cancelImmediately
        ? {
            // For immediate cancellation, we cancel the subscription
          }
        : {
            // For end-of-period cancellation, we update the subscription
            cancel_at_period_end: true,
          };

      // Add metadata for tracking
      const metadata: Record<string, string> = {
        cancelled_by: 'user',
        cancelled_at: new Date().toISOString(),
        local_user_id: userId,
      };

      if (cancellationReason) {
        // also add the cancellation reason to the metadata
        metadata.cancellation_reason = cancellationReason;
      }

      // 5. Execute the cancellation in Stripe
      let cancelledSubscription: Stripe.Subscription;

      if (cancelImmediately) {
        this.logger.log(
          `Cancelling subscription ${user.stripeSubscriptionId} immediately...`,
        );
        cancelledSubscription = await this.stripe.subscriptions.cancel(
          user.stripeSubscriptionId,
          {
            ...cancelParams,
            // metadata,
            ...(cancellationReason && {
              cancellation_details: {
                comment: cancellationReason,
              },
            }),
          } as Stripe.SubscriptionCancelParams,
        );
      } else {
        this.logger.log(
          `Setting subscription ${user.stripeSubscriptionId} to cancel at period end...`,
        );
        cancelledSubscription = await this.stripe.subscriptions.update(
          user.stripeSubscriptionId,
          {
            ...cancelParams,
            ...(cancellationReason && {
              cancellation_details: {
                comment: cancellationReason,
              },
            }),
            metadata: {
              ...metadata,
            },
          } as Stripe.SubscriptionUpdateParams,
        );
      }

      this.logger.log(
        `Successfully processed cancellation for subscription ${cancelledSubscription.id}. Status: ${cancelledSubscription.status}, Cancel at period end: ${cancelledSubscription.cancel_at_period_end}`,
      );

      // 6. Update local database
      await this.updateLocalUserAfterCancellation(
        userId,
        cancelledSubscription,
        cancelImmediately,
      );

      return cancelledSubscription;
    } catch (error) {
      this.logger.error(
        `Failed to cancel subscription for user ${userId}: ${error.message}`,
        error.stack,
      );
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException(
        `Could not cancel subscription: ${error.message}`,
      );
    }
  }

  /**
   * Updates the local user data after subscription cancellation
   * @param userId The user ID
   * @param cancelledSubscription The cancelled Stripe subscription
   * @param wasImmediateCancellation Whether it was an immediate cancellation
   * @private
   */
  private async updateLocalUserAfterCancellation(
    userId: string,
    cancelledSubscription: Stripe.Subscription,
    wasImmediateCancellation: boolean,
  ): Promise<void> {
    const updateData: Partial<UserDoc> = {
      subscriptionStatus: cancelledSubscription.status,
      lastStripeSync: new Date(),
    };

    if (
      wasImmediateCancellation ||
      cancelledSubscription.status === 'canceled'
    ) {
      // Immediate cancellation or already cancelled
      updateData.hasActiveSubscription = false;
      updateData.paymentStatus = 'canceled';
      updateData.stripeSubscriptionId = null;
      updateData.activeStripePriceId = null;
      updateData.currentPeriodEnd = null;
    } else if (cancelledSubscription.cancel_at_period_end) {
      // Scheduled for cancellation at period end - subscription remains active until then
      updateData.hasActiveSubscription = true; // Still active until period end
      updateData.paymentStatus = 'active'; // Still active until period end
      // Keep other subscription data intact since it's still active
    }

    await this.userModel.findByIdAndUpdate(userId, updateData);
    this.logger.log(
      `Updated local user ${userId} data after cancellation processing.`,
    );
  }

  /**
   * Clears local subscription data when subscription is not found in Stripe
   * @param userId The user ID
   * @private
   */
  private async clearLocalSubscriptionData(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      stripeSubscriptionId: null,
      subscriptionStatus: 'canceled',
      activeStripePriceId: null,
      currentPeriodEnd: null,
      hasActiveSubscription: false,
      paymentStatus: 'canceled',
      lastStripeSync: new Date(),
    });
    this.logger.log(
      `Cleared subscription data for user ${userId} as it no longer exists in Stripe.`,
    );
  }

  async fetchSubDetails(userId: string) {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const plan = user.planTier as PlanName;

    // fetch subscription limits
    const limit = CAMPAIGN_LIMIT[plan];

    return {
      planTier: plan,
      campaignLimit: limit,
    };
  }
}
