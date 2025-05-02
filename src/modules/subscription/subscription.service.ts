import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { User, UserDoc } from '../customer/schemas/user.schema';
import { StripeCustomerService } from '../customer/customer.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDoc>,
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
    private readonly stripeCustomerService: StripeCustomerService,
  ) {}

  // Helper mapping base Price IDs to their corresponding Commission Price IDs
  // IMPORTANT: Use the actual Price IDs you created in your Stripe Dashboard!
  private commissionPriceMap: Record<string, string | null> = {
    // --- Starter Plan ---
    price_1RJOIF4K0EUJXpsuXoWVsLvI: 'price_1RJP6w4K0EUJXpsu4Pb5Eyt0',
    price_1RJOsq4K0EUJXpsut6AGoSqQ: 'price_1RJP6w4K0EUJXpsu4Pb5Eyt0',
    price_1RJOvK4K0EUJXpsu9JjKZk5q: 'price_1RJP6w4K0EUJXpsu4Pb5Eyt0',
    // --- Grow Plan ---
    price_1RJORI4K0EUJXpsuA3Uc1yff: 'price_1RJPYi4K0EUJXpsuPrnE0F0R',
    price_1RJOzX4K0EUJXpsuhbvXdRFy: 'price_1RJPYi4K0EUJXpsuPrnE0F0R',
    price_1RJP0t4K0EUJXpsuGrlrCi0Z: 'price_1RJPYi4K0EUJXpsuPrnE0F0R',
    // --- Scale Plan ---
    price_1RJOWj4K0EUJXpsuQ3rqPxEU: 'price_1RJPa44K0EUJXpsuMndP6MZx',
    price_1RJP4F4K0EUJXpsupXziADUr: 'price_1RJPa44K0EUJXpsuMndP6MZx',
    price_1RJP5L4K0EUJXpsuP0J14AlF: 'price_1RJPa44K0EUJXpsuMndP6MZx',
    // --- Free Plan (Example: Assumes free plan has NO billable commission price) ---
    price_1RJOC84K0EUJXpsuHnFOBtZf: 'price_1RJP6w4K0EUJXpsu4Pb5Eyt0', // null,
    // Add other Price IDs if necessary
  };

  /**
   * Creates a Stripe subscription for a user.
   * @param userId The ID of the user in your local database.
   * @param createSubscriptionDto DTO containing the Price ID and optional Payment Method ID.
   * @returns The created Stripe Subscription object.
   */
  async createSubscription(
    userId: string,
    createSubscriptionDto: CreateSubscriptionDto,
  ): Promise<Stripe.Subscription> {
    // We will return the Stripe.Subscription object
    const { priceId, paymentMethodId } = createSubscriptionDto;
    this.logger.log(
      `Attempting to create subscription for user ${userId} with price ${priceId}`,
    );

    let stripeCustomerId: string;

    try {
      // 1. Find the user in the local database
      const user = await this.userModel
        .findById(userId)
        .select('+stripeCustomerId')
        .exec(); // Ensure stripeCustomerId is selected if needed
      if (!user) {
        this.logger.error(`User not found with ID: ${userId}`);
        throw new NotFoundException(`User not found with ID: ${userId}`);
      }

      // 2. Get or Create Stripe Customer ID
      if (user.stripeCustomerId) {
        stripeCustomerId = user.stripeCustomerId;
        this.logger.log(
          `Found existing Stripe Customer ID: ${stripeCustomerId} for user ${userId}`,
        );
        // Optional: Verify customer exists in Stripe here if paranoid
        // try { await this.stripeCustomerService.getStripeCustomer(stripeCustomerId); } catch (e) { ... }
      } else {
        this.logger.log(
          `No Stripe Customer ID found for user ${userId}. Creating new Stripe Customer...`,
        );
        // Use the injected StripeCustomerService to create the customer
        const newStripeCustomer =
          await this.stripeCustomerService.createStripeCustomer(user);
        stripeCustomerId = newStripeCustomer.id;
        this.logger.log(
          `Created new Stripe Customer ID: ${stripeCustomerId} for user ${userId}`,
        );
        // The createStripeCustomer method already updates the userModel in its implementation
      }

      // 3. Handle Payment Method attachment (if provided)
      if (paymentMethodId) {
        this.logger.log(
          `PaymentMethod ID ${paymentMethodId} provided. Attaching to customer ${stripeCustomerId}...`,
        );
        try {
          // Attach the payment method to the customer
          const attachedPaymentMethod = await this.stripe.paymentMethods.attach(
            paymentMethodId,
            {
              customer: stripeCustomerId,
            },
          );

          // get the attached payment method id returned from stripe
          const actualAttachedPmId = attachedPaymentMethod.id;

          this.logger.log(
            `Successfully attached PaymentMethod ${paymentMethodId} to ${actualAttachedPmId}`,
          );

          // Set it as the default payment method for future invoices (important for recurring payments)
          await this.stripe.customers.update(stripeCustomerId, {
            invoice_settings: { default_payment_method: actualAttachedPmId },
          });
          this.logger.log(
            `Set PaymentMethod ${actualAttachedPmId} as default for ${stripeCustomerId}`,
          );
          // Optionally update local user record with default PM ID here or rely on webhook
          await this.userModel.findByIdAndUpdate(userId, {
            defaultPaymentMethod: actualAttachedPmId,
            lastStripeSync: new Date(),
          });
          this.logger.log(
            `Updated local user ${userId} default payment method ID to ${actualAttachedPmId}.`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to attach/set default PaymentMethod (Input ID: ${paymentMethodId}) for customer ${stripeCustomerId}: ${error.message}`, // Log input ID too
            error.stack,
          );
          throw new BadRequestException(
            `Failed to set up payment method: ${error.message}`,
          );
        }
      } else {
        // If no payment method is provided now, Stripe will try to use the customer's existing default.
        // If it's a paid plan and there's no default, the subscription creation might fail (or go to 'incomplete').
        this.logger.log(
          `No new PaymentMethod ID provided for customer ${stripeCustomerId}. Using existing default if available.`,
        );
      }

      // 4. Determine the correct Commission Price ID based on the base priceId
      const commissionPriceId = this.commissionPriceMap[priceId];

      // Validate that the base priceId exists in our mapping
      if (typeof commissionPriceId === 'undefined') {
        this.logger.error(
          `Invalid or unmapped base Price ID provided: ${priceId}`,
        );
        throw new BadRequestException(
          `Invalid subscription plan selected: ${priceId}.`,
        );
      }

      if (commissionPriceId) {
        this.logger.log(
          `Found corresponding Commission Price ID: ${commissionPriceId} for base Price ID: ${priceId}`,
        );
      } else {
        this.logger.log(
          `No corresponding Commission Price ID found or needed for base Price ID: ${priceId} (e.g., Free Plan)`,
        );
      }

      // 5. Create the subscription in Stripe using stripe.subscriptions.create()
      // 5. Prepare Subscription Items array
      const subscriptionItems: Stripe.SubscriptionCreateParams.Item[] = [
        { price: priceId }, // Always include the base price
      ];

      if (commissionPriceId) {
        // Only add the commission item if it's applicable for the plan
        subscriptionItems.push({ price: commissionPriceId });
      }
      this.logger.log(
        `Preparing to create subscription with items: ${JSON.stringify(subscriptionItems)}`,
      );

      // 6. Prepare Subscription Creation Parameters
      const subscriptionParams: Stripe.SubscriptionCreateParams = {
        customer: stripeCustomerId,
        items: subscriptionItems,
        // Expand necessary objects to check status immediately after creation
        expand: ['latest_invoice', 'pending_setup_intent'],
        // Automatically charge the default payment method
        collection_method: 'charge_automatically',
        // Optional: Add metadata to link Stripe Subscription back to your user
        metadata: {
          localUserId: userId,
        },
      };

      // 7. Create the subscription in Stripe
      this.logger.log(
        `Creating Stripe subscription for customer ${stripeCustomerId}...`,
      );
      const stripeSubscription =
        await this.stripe.subscriptions.create(subscriptionParams);

      this.logger.log(
        `Successfully created Stripe subscription ${stripeSubscription.id}`,
      );

      // 8. Check Initial Payment Status (if applicable)
      //    This is crucial for paid plans to ensure the first payment went through or handle required actions.
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
          // Depending on desired UX, you might update local status to 'incomplete' instead of throwing
          throw new BadRequestException(
            `Payment required or needs further action. Status: ${paymentIntent.status}`,
          );
        }
      } else if (stripeSubscription.status === 'incomplete') {
        // Handle cases where subscription goes directly into 'incomplete' status
        this.logger.warn(
          `Subscription ${stripeSubscription.id} created with status 'incomplete'. Payment may be required.`,
        );

        // If we couldn't determine a specific action, return a generic message
        throw new BadRequestException({
          message:
            'Subscription created but payment is incomplete. Please check payment details.',
          code: 'incomplete_payment',
          subscriptionId: stripeSubscription.id,
        });
      }

      // 9. Update local database (User or dedicated Subscription record)
      const updateData = {
        stripeSubscriptionId: stripeSubscription.id,
        // Use the status from the created subscription ('active', 'trialing', 'incomplete', etc.)
        subscriptionStatus: stripeSubscription.status, // Using a dedicated field is clearer
        paymentStatus:
          stripeSubscription.status === 'past_due'
            ? 'past_due' // Update paymentStatus too
            : stripeSubscription.status === 'active' ||
                stripeSubscription.status === 'trialing'
              ? 'active'
              : 'none',
        activeStripePriceId: priceId, // Store the base price ID user subscribed to
        currentPeriodEnd: new Date(
          stripeSubscription?.items?.data[0].current_period_end * 1000,
        ), // Convert Stripe timestamp
        hasActiveSubscription: ['active', 'trialing'].includes(
          stripeSubscription.status,
        ), // Determine based on status
        lastStripeSync: new Date(),
      };

      this.logger.log(
        `Updating local user ${userId} with subscription data: ${JSON.stringify(updateData)}`,
      );
      await this.userModel.findByIdAndUpdate(userId, updateData);
      this.logger.log(`Successfully updated user ${userId} in local database.`);

      // 10. Return the created Stripe Subscription object
      return stripeSubscription;
    } catch (error) {
      this.logger.error(
        `Failed to create subscription for user ${userId}: ${error.message}`,
        error.stack,
      );
      // Re-throw specific errors or a generic one
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException(
        `Could not create subscription: ${error.message}`,
      );
    }
  }
}
