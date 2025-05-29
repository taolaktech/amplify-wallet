import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { User, UserDoc } from '../customer/schemas/user.schema';
import { StripeCustomerService } from '../customer/customer.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ChangePlanDto } from './dto/change-subscription.dto';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDoc>,
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
    const updateData = {
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
      const user = await this.userModel.findById(userId)
        .select('stripeCustomerId stripeSubscriptionId activeStripePriceId') // Select necessary fields
        .exec();

      if (!user) {
        this.logger.error(`User not found with ID: ${userId} for plan change.`);
        throw new NotFoundException(`User not found with ID: ${userId}.`);
      }

      if (!user.stripeSubscriptionId) {
        this.logger.warn(`User ${userId} does not have an active Stripe subscription to change.`);
        throw new BadRequestException('No active subscription found to change.');
      }

      if (!user.stripeCustomerId) {
        this.logger.error(`User ${userId} has a subscription ID but no Stripe Customer ID. Data inconsistency.`);
        throw new BadRequestException('Customer configuration error.');
      }
      
      if (user.activeStripePriceId === newPriceId) {
        this.logger.warn(`User ${userId} is already subscribed to price ${newPriceId}. No change needed.`);
        // Retrieve and return the current subscription as no change is made
        return this.stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      }

      // 2. Retrieve the current subscription from Stripe to get its items
      // This is crucial to find the ID of the subscription item to update.
      let currentSubscription: Stripe.Subscription;
      try {
        currentSubscription = await this.stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
          { expand: ['items'] }, // Expand items to get their IDs
        );
      } catch (error) {
        this.logger.error(`Failed to retrieve current subscription ${user.stripeSubscriptionId} from Stripe: ${error.message}`, error.stack);
        if (error.code === 'resource_missing') {
            // Local DB might be out of sync. Clear local subscription data.
            await this.userModel.findByIdAndUpdate(userId, {
                stripeSubscriptionId: null,
                activeStripePriceId: null,
                subscriptionStatus: 'canceled', // Or some other inactive status
                hasActiveSubscription: false,
            });
            throw new NotFoundException('Active subscription not found in Stripe. Please subscribe first.');
        }
        throw new BadRequestException(`Could not retrieve current subscription details: ${error.message}`);
      }

      if (!currentSubscription.items || currentSubscription.items.data.length === 0) {
        this.logger.error(`Subscription ${user.stripeSubscriptionId} has no items. Cannot update.`);
        throw new BadRequestException('Current subscription has no items to update.');
      }

      /**
       * Assuming the base plan is the first item (or the only item since commission is
       * separate)
       * If you had multiple items, you'd need more sophisticated logic to find the
       * correct one.
       */
      const currentSubscriptionItemId = currentSubscription.items.data[0].id;
      if (!currentSubscriptionItemId) {
          this.logger.error(`Could not find a subscription item ID for subscription ${user.stripeSubscriptionId}.`);
          throw new BadRequestException('Cannot identify the current subscription item to update.');
      }

      this.logger.log(`Found current subscription item ID: ${currentSubscriptionItemId} for subscription ${user.stripeSubscriptionId}`);

      // 3. Prepare parameters for updating the subscription
      const updateParams: Stripe.SubscriptionUpdateParams = {
        items: [
          {
            id: currentSubscriptionItemId, // The ID of the subscription item to modify
            price: newPriceId,             // The ID of the new price
            // quantity: 1, // If your prices are quantity-based
          },
          // If you were to remove other items (like an old commission item), you'd add:
          // { id: oldOtherItemId, deleted: true }
        ],
        proration_behavior: prorationBehavior,
        // payment_behavior: 'default_incomplete', // Optional: For finer control over payment failures on prorated invoices
        expand: ['latest_invoice','pending_setup_intent'], // To check for immediate payment on upgrade
      };

      // 4. Call Stripe to update the subscription
      this.logger.log(`Updating Stripe subscription ${user.stripeSubscriptionId} to price ${newPriceId}...`);
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
      this.logger.log(`Local user ${userId} lastStripeSync updated after plan change request.`);

      return updatedStripeSubscription

    } catch (error) {
      this.logger.error(
        `Failed to change subscription for user ${userId} to price ${newPriceId}: ${error.message}`,
        error.stack,
      );
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Could not change subscription: ${error.message}`,
      );
    }
  }
}
