import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, startSession } from 'mongoose';
import Stripe from 'stripe';
import {
  TransactionDocument,
  UserDoc,
  WalletDocument,
} from '../../database/schema';
import { ConfigService } from '@nestjs/config';
import { TRANSACTION_STATUS } from 'src/common/types/transaction.types';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly stripeWebhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel('users') private userModel: Model<UserDoc>,
    @InjectModel('transactions')
    private transactionModel: Model<TransactionDocument>,
    @InjectConnection() private readonly connection: mongoose.Connection,
    @InjectModel('wallets') private walletModel: Model<WalletDocument>,
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
  ) {
    this.stripeWebhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    if (!this.stripeWebhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not set!');
      throw new Error(
        'Webhook signing secret is not configured on the server.',
      );
    }
  }

  async handleIncomingEvent(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ) {
    this.logger.log('WebhookService: Processing incoming event...');

    if (!signature) {
      this.logger.warn('Webhook request missing Stripe signature header.');
      throw new BadRequestException('Missing Stripe signature header.');
    }

    if (!rawBody) {
      this.logger.error(
        'Webhook request missing raw body. Check server configuration.',
      );
      throw new BadRequestException('Missing raw request body.');
    }

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.stripeWebhookSecret,
      );
      this.logger.log(
        `Stripe event constructed successfully: ${event.id}, Type: ${event.type}`,
      );
    } catch (err) {
      this.logger.error(
        `Webhook signature verification failed: ${err.message}`,
        err.stack,
      );
      throw new BadRequestException(
        `Webhook error (signature verification failed): ${err.message}`,
      );
    }

    // --- Event Dispatching Logic ---
    this.logger.log(`Dispatching event type: ${event.type}`);
    const stripeEventObject = event.data.object; // The actual Stripe object related to the event

    try {
      switch (event.type) {
        // === Subscription Lifecycle & Initial Payment ===
        case 'invoice.paid':
          await this.handleInvoicePaid(stripeEventObject as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(
            stripeEventObject as Stripe.Invoice,
          );
          break;
        case 'customer.subscription.updated':
          await this.handleCustomerSubscriptionUpdated(
            stripeEventObject as Stripe.Subscription,
          );
          break;
        case 'customer.subscription.deleted': // Handles cancellations
          await this.handleCustomerSubscriptionDeleted(
            stripeEventObject as Stripe.Subscription,
          );
          break;
        // === Payment Method Management ===
        case 'setup_intent.succeeded':
          await this.handleSetupIntentSucceeded(
            stripeEventObject as Stripe.SetupIntent,
          );
          break;
        case 'customer.updated':
          await this.handleCustomerUpdated(
            stripeEventObject as Stripe.Customer,
          );
          break;
        case 'payment_intent.succeeded':
          await this.handleSuccesfullCharge(
            stripeEventObject as Stripe.PaymentIntent,
          );
          break;
        case 'payment_intent.payment_failed':
          await this.handleFailedCharge(
            stripeEventObject as Stripe.PaymentIntent,
          );
          break;
        // === Other useful events you might add later ===
        // case 'customer.subscription.trial_will_end':
        //   // Handle trial ending soon notifications
        //   break;
        // case 'payment_method.attached':
        //   // Handle payment method attachment if not using SetupIntents exclusively
        //   break;
        // case 'payment_method.detached':
        //   // Handle payment method detachment
        //   break;
        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Error processing event ${event.id} (type: ${event.type}): ${error.message}`,
        error.stack,
      );
      // To prevent Stripe from retrying indefinitely for an error within a specific handler,
      // you might choose not to re-throw the error here, or re-throw a specific type
      // that your global exception filter handles differently for webhooks.
      // For now, we'll re-throw to indicate a processing failure.
      // If this error is thrown, Stripe will retry the webhook.
      throw new BadRequestException(
        `Error processing webhook event ${event.type}: ${error.message}`,
      );
    }

    // If we reach here, it means the event was either handled or was an unhandled type
    // The controller will send a 200 OK back to Stripe.
  }

  /**
   * Handles the 'invoice.paid' event by updating user information based on the invoice details.
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    this.logger.log(
      `Handling 'invoice.paid': Invoice ID ${invoice.id}, Customer ID ${invoice.customer}`,
    );

    if (!invoice.customer || typeof invoice.customer !== 'string') {
      this.logger.error(
        `'invoice.paid' event for invoice ${invoice.id} is missing a valid customer ID.`,
      );
      return;
    }
    const stripeCustomerId = invoice.customer;

    const user = await this.userModel.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    if (!user) {
      this.logger.warn(
        `User not found for Stripe Customer ID: ${stripeCustomerId} from invoice.paid event ${invoice.id}.`,
      );
      return;
    }

    this.logger.log(
      `Found user ${user._id} for Stripe Customer ID ${stripeCustomerId}.`,
    );

    const updateData: Partial<UserDoc> = {
      paymentStatus: 'active',
      lastStripeSync: new Date(),
    };

    // Get subscription ID from invoice lines **
    let subscriptionIdFromInvoice: string | null = null;
    if (invoice.lines && invoice.lines.data && invoice.lines.data.length > 0) {
      for (const lineItem of invoice.lines.data) {
        // A line item's 'subscription' property holds the ID of the subscription if this line item pertains to one.
        if (typeof lineItem.subscription === 'string') {
          subscriptionIdFromInvoice = lineItem.subscription;
          this.logger.log(
            `Found subscription ID ${subscriptionIdFromInvoice} from invoice line item ${lineItem.id}.`,
          );
          break; // Found it, use the first one
        }
      }
    }

    if (subscriptionIdFromInvoice) {
      this.logger.log(
        `Invoice ${invoice.id} is tied to subscription ID: ${subscriptionIdFromInvoice}. Retrieving subscription details.`,
      );
      try {
        const subscription = await this.stripe.subscriptions.retrieve(
          subscriptionIdFromInvoice,
        );
        this.logger.log(
          `Retrieved subscription ${subscription.id} (status: ${subscription.status}) associated with invoice ${invoice.id}`,
        );

        updateData.stripeSubscriptionId = subscription.id;
        updateData.subscriptionStatus = subscription.status;
        if (
          subscription.items &&
          subscription.items.data &&
          subscription.items.data.length > 0 &&
          subscription.items.data[0].price
        ) {
          updateData.activeStripePriceId = subscription.items.data[0].price.id;
        } else {
          this.logger.warn(
            `Subscription ${subscription.id} has no items or item price. Cannot set activeStripePriceId.`,
          );
        }
        // updateData.currentPeriodStart = new Date(
        //   subscription.current_period_start * 1000,
        // );
        updateData.currentPeriodEnd = new Date(invoice.period_end * 1000);
        updateData.hasActiveSubscription = ['active', 'trialing'].includes(
          subscription.status,
        );
      } catch (subError) {
        this.logger.error(
          `Failed to retrieve subscription ${subscriptionIdFromInvoice} for invoice ${invoice.id}: ${subError.message}`,
          subError.stack,
        );
      }
    } else {
      this.logger.log(
        `Invoice ${invoice.id} does not appear to be tied to a subscription via its line items (e.g., one-off invoice).`,
      );
    }

    await this.userModel.updateOne(
      { stripeCustomerId: stripeCustomerId },
      { $set: updateData },
    );
    this.logger.log(
      `User ${user._id} updated successfully for invoice.paid event.`,
    );

    // Send receipt/notification
  }

  /**
   * Handles the 'invoice.payment_failed' Stripe webhook event
   *
   * This method processes a failed invoice payment by:
   * - Identifying the associated user via Stripe customer ID
   * - Updating the user's payment and subscription status
   * - Logging relevant information about the failed payment
   *
   * @param invoice The Stripe invoice that failed payment
   * @private
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    this.logger.log(
      `Handling 'invoice.payment_failed': Invoice ID ${invoice.id}, Customer ID ${invoice.customer}`,
    );

    if (!invoice.customer || typeof invoice.customer !== 'string') {
      this.logger.error(
        `'invoice.payment_failed' event for invoice ${invoice.id} is missing a valid customer ID.`,
      );
      return;
    }
    const stripeCustomerId = invoice.customer;
    const user = await this.userModel.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    if (!user) {
      this.logger.warn(
        `User not found for Stripe Customer ID: ${stripeCustomerId} from invoice.payment_failed event ${invoice.id}.`,
      );
      return;
    }

    this.logger.log(
      `Found user ${user._id} for Stripe Customer ID ${stripeCustomerId}.`,
    );

    const updateData: Partial<UserDoc> = {
      paymentStatus: 'past_due',
      lastStripeSync: new Date(),
    };

    // Get subscription ID from invoice lines **
    let subscriptionIdFromInvoice: string | null = null;
    if (invoice.lines && invoice.lines.data && invoice.lines.data.length > 0) {
      for (const lineItem of invoice.lines.data) {
        if (typeof lineItem.subscription === 'string') {
          subscriptionIdFromInvoice = lineItem.subscription;
          this.logger.log(
            `Found subscription ID ${subscriptionIdFromInvoice} from invoice line item ${lineItem.id} for failed invoice.`,
          );
          break;
        }
      }
    }

    if (subscriptionIdFromInvoice) {
      try {
        const subscription = await this.stripe.subscriptions.retrieve(
          subscriptionIdFromInvoice,
        );
        updateData.subscriptionStatus = subscription.status;
        if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
          updateData.hasActiveSubscription = false;
        }
      } catch (subError) {
        this.logger.error(
          `Failed to retrieve subscription ${subscriptionIdFromInvoice} for failed invoice ${invoice.id}: ${subError.message}`,
          subError.stack,
        );
      }
    } else {
      this.logger.log(
        `Failed invoice ${invoice.id} does not appear to be tied to a subscription via its line items.`,
      );
    }

    await this.userModel.updateOne(
      { stripeCustomerId: stripeCustomerId },
      { $set: updateData },
    );
    this.logger.log(
      `User ${user._id} updated for invoice.payment_failed event.`,
    );

    // Send notification to update payment method
  }

  /**
   * Handles the 'customer.subscription.updated' Stripe webhook event
   * Updates the user's subscription details in the database based on the Stripe subscription information
   * This now includes handling for cancellation-related updates
   *
   * @param subscription - The Stripe subscription object from the webhook event
   * @private
   */
  private async handleCustomerSubscriptionUpdated(
    subscription: Stripe.Subscription,
  ) {
    this.logger.log(
      `Handling 'customer.subscription.updated': Subscription ID ${subscription.id}, Status ${subscription.status}, Customer ID ${subscription.customer}, Cancel at period end: ${subscription.cancel_at_period_end}`,
    );

    if (!subscription.customer || typeof subscription.customer !== 'string') {
      this.logger.error(
        `'customer.subscription.updated' event for subscription ${subscription.id} is missing a valid customer ID.`,
      );
      return;
    }
    const stripeCustomerId = subscription.customer;
    const user = await this.userModel.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    if (!user) {
      this.logger.warn(
        `User not found for Stripe Customer ID: ${stripeCustomerId} from customer.subscription.updated event ${subscription.id}.`,
      );
      return;
    }
    this.logger.log(
      `Found user ${user._id} for Stripe Customer ID ${stripeCustomerId}.`,
    );

    const updateData: Partial<UserDoc> = {
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      activeStripePriceId:
        subscription.items &&
        subscription.items.data &&
        subscription.items.data.length > 0 &&
        subscription.items.data[0].price
          ? subscription.items.data[0].price.id
          : null,
      currentPeriodEnd: new Date(
        subscription?.items?.data[0]?.current_period_end * 1000,
      ),
      lastStripeSync: new Date(),
    };

    // Handle subscription status and active state based on cancellation status
    if (subscription.status === 'canceled') {
      // Subscription is fully canceled
      updateData.hasActiveSubscription = false;
      updateData.paymentStatus = 'canceled';
      updateData.stripeSubscriptionId = null;
      updateData.activeStripePriceId = null;
      updateData.currentPeriodEnd = null;
    } else if (subscription.cancel_at_period_end) {
      // Subscription is scheduled for cancellation but still active
      updateData.hasActiveSubscription = ['active', 'trialing'].includes(
        subscription.status,
      );
      updateData.paymentStatus =
        subscription.status === 'past_due'
          ? 'past_due'
          : subscription.status === 'unpaid'
            ? 'past_due'
            : ['active', 'trialing'].includes(subscription.status)
              ? 'active'
              : 'none';

      this.logger.log(
        `Subscription ${subscription.id} is scheduled for cancellation at period end (${new Date(subscription?.items?.data[0]?.current_period_end * 1000).toISOString()}) but remains active until then.`,
      );
    } else {
      // Normal subscription logic (not scheduled for cancellation and not canceled)
      updateData.hasActiveSubscription = ['active', 'trialing'].includes(
        subscription.status,
      );
      updateData.paymentStatus =
        subscription.status === 'past_due'
          ? 'past_due'
          : subscription.status === 'unpaid'
            ? 'past_due'
            : ['active', 'trialing'].includes(subscription.status)
              ? 'active'
              : 'none';
    }

    await this.userModel.updateOne(
      { stripeCustomerId: stripeCustomerId },
      { $set: updateData },
    );
    this.logger.log(
      `User ${user._id} updated for customer.subscription.updated event.`,
    );
  }

  /**
   * Handles the 'customer.subscription.deleted' Stripe webhook event.
   *
   * Updates the user's subscription-related fields in the database when a Stripe subscription is deleted,
   * setting relevant fields to indicate the subscription has been canceled.
   *
   * @param subscription The Stripe subscription object from the webhook event
   * @private
   */
  private async handleCustomerSubscriptionDeleted(
    subscription: Stripe.Subscription,
  ) {
    this.logger.log(
      `Handling 'customer.subscription.deleted': Subscription ID ${subscription.id}, Customer ID ${subscription.customer}`,
    );

    if (!subscription.customer || typeof subscription.customer !== 'string') {
      this.logger.error(
        `'customer.subscription.deleted' event for subscription ${subscription.id} is missing a valid customer ID.`,
      );
      return;
    }
    const stripeCustomerId = subscription.customer;
    const user = await this.userModel.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    if (!user) {
      this.logger.warn(
        `User not found for Stripe Customer ID: ${stripeCustomerId} from customer.subscription.deleted event ${subscription.id}.`,
      );
      return;
    }
    this.logger.log(
      `Found user ${user._id} for Stripe Customer ID ${stripeCustomerId}.`,
    );

    const updateData: Partial<UserDoc> = {
      stripeSubscriptionId: null,
      subscriptionStatus: 'canceled',
      activeStripePriceId: null,
      currentPeriodEnd: null,
      hasActiveSubscription: false,
      paymentStatus: 'canceled',
      lastStripeSync: new Date(),
    };

    await this.userModel.updateOne(
      { stripeCustomerId: stripeCustomerId },
      { $set: updateData },
    );
    this.logger.log(
      `User ${user._id} updated for customer.subscription.deleted event.`,
    );
  }

  /**
   * Handles the 'setup_intent.succeeded' event by updating the user's default payment method in the database and syncing with Stripe.
   * @param setupIntent The Stripe SetupIntent object containing necessary information for handling the event.
   * @private
   */
  private async handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent) {
    this.logger.log(
      `Handling 'setup_intent.succeeded': SetupIntent ID ${setupIntent.id}, Customer ID ${setupIntent.customer}, PaymentMethod ID ${setupIntent.payment_method}`,
    );

    if (!setupIntent.customer || typeof setupIntent.customer !== 'string') {
      this.logger.error(
        `'setup_intent.succeeded' event for SI ${setupIntent.id} is missing a valid customer ID.`,
      );
      return;
    }
    const stripeCustomerId = setupIntent.customer;
    const newPaymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;

    if (!newPaymentMethodId) {
      this.logger.error(
        `'setup_intent.succeeded' event for SI ${setupIntent.id} is missing a valid payment_method ID.`,
      );
      return;
    }

    const user = await this.userModel.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    if (!user) {
      this.logger.warn(
        `User not found for Stripe Customer ID: ${stripeCustomerId} from setup_intent.succeeded event ${setupIntent.id}.`,
      );
      return;
    }
    this.logger.log(
      `Found user ${user._id} for Stripe Customer ID ${stripeCustomerId}.`,
    );

    const updateData: Partial<UserDoc> = {
      lastStripeSync: new Date(),
    };

    if (!user.defaultPaymentMethod) {
      this.logger.log(
        `User ${user._id} has no default payment method. Setting ${newPaymentMethodId} as default.`,
      );
      try {
        await this.stripe.customers.update(stripeCustomerId, {
          invoice_settings: { default_payment_method: newPaymentMethodId },
        });
        updateData.defaultPaymentMethod = newPaymentMethodId;
        this.logger.log(
          `Successfully set ${newPaymentMethodId} as default for Stripe Customer ${stripeCustomerId}.`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to set ${newPaymentMethodId} as default for Stripe Customer ${stripeCustomerId}: ${error.message}`,
          error.stack,
        );
      }
    }

    await this.userModel.updateOne(
      { stripeCustomerId: stripeCustomerId },
      { $set: updateData },
    );
    this.logger.log(
      `User ${user._id} updated for setup_intent.succeeded event.`,
    );
  }

  /**
   * Handles the 'customer.updated' event by updating the user information in the database based on the changes received from Stripe.
   *
   * @param customer The updated Stripe customer object triggering the event.
   * @private
   */
  private async handleCustomerUpdated(customer: Stripe.Customer) {
    this.logger.log(`Handling 'customer.updated': Customer ID ${customer.id}`);

    const stripeCustomerId = customer.id;
    const user = await this.userModel.findOne({
      stripeCustomerId: stripeCustomerId,
    });

    if (!user) {
      this.logger.warn(
        `User not found for Stripe Customer ID: ${stripeCustomerId} from customer.updated event.`,
      );
      return;
    }
    this.logger.log(
      `Found user ${user._id} for Stripe Customer ID ${stripeCustomerId}.`,
    );

    const updateData: Partial<UserDoc> = {
      lastStripeSync: new Date(),
    };

    const currentDefaultPmInStripe =
      typeof customer.invoice_settings?.default_payment_method === 'string'
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id;

    if (user.defaultPaymentMethod !== currentDefaultPmInStripe) {
      this.logger.log(
        `Default payment method for customer ${customer.id} changed in Stripe. Current Stripe default: ${currentDefaultPmInStripe}, Local default: ${user.defaultPaymentMethod}. Updating local DB.`,
      );
      updateData.defaultPaymentMethod = currentDefaultPmInStripe || null;
    }

    const hasDefaultPmUpdate = updateData.hasOwnProperty(
      'defaultPaymentMethod',
    );
    if (
      Object.keys(updateData).length > 1 ||
      (hasDefaultPmUpdate &&
        updateData.defaultPaymentMethod !== user.defaultPaymentMethod)
    ) {
      await this.userModel.updateOne(
        { stripeCustomerId: stripeCustomerId },
        { $set: updateData },
      );
      this.logger.log(`User ${user._id} updated for customer.updated event.`);
    } else {
      this.logger.log(
        `No relevant changes detected for user ${user._id} in customer.updated event. Skipping DB update.`,
      );
    }
  }

  /**
   * Handles the 'payment_intent.succeeded' event by updating the transaction status to COMPLETED
   *
   * @param paymentIntent - The Stripe PaymentIntent object representing the successful charge.
   * @private
   */
  private async handleSuccesfullCharge(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(
      `Handling 'payment_intent.succeeded' : PaymentIntent ID ${paymentIntent.id}, Customer ID ${paymentIntent.customer}`,
    );

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      // find pending transaction
      const existingTransaction = await this.transactionModel.findOneAndUpdate(
        {
          'metadata.paymentIntentId': paymentIntent.id,
          status: TRANSACTION_STATUS.PENDING,
        },
        {
          $set: {
            status: TRANSACTION_STATUS.COMPLETED,
          },
        },
        { session },
      );

      if (!existingTransaction) {
        this.logger.log(
          `Transaction already processed or not found for this successful payment intent: ${paymentIntent.id}`,
        );
        // abort transaction
        await session.abortTransaction();
        return;
      }

      // increment the users wallet balance
      await this.walletModel.findOneAndUpdate(
        { userId: existingTransaction.userId.toString() },
        {
          $inc: { balance: paymentIntent.amount },
        },
        { session },
      );

      // commit transaction
      await session.commitTransaction();
    } catch (error) {
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Handles the 'payment_intent.payment_failed' event by updating the transaction status to FAILED
   *
   * @param paymentIntent - The Stripe PaymentIntent object representing the successful charge.
   * @private
   */
  private async handleFailedCharge(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(
      `Handling 'payment_intent.payment_failed': PaymentIntent ID ${paymentIntent.id}, Customer ID ${paymentIntent.customer}`,
    );

    const existingTransaction = await this.transactionModel.findOneAndUpdate(
      {
        'metadata.paymentIntentId': paymentIntent.id,
        status: TRANSACTION_STATUS.PENDING,
      },
      {
        $set: {
          status: TRANSACTION_STATUS.FAILED,
          // use dot notation to prevent overwriting existing metadata
          'metadata.errorMessage': paymentIntent.last_payment_error?.message,
        },
      },
    );

    if (!existingTransaction) {
      this.logger.log(
        `No pending transaction found for this failed payment intent: ${paymentIntent.id}`,
      );
      return;
    }

    this.logger.log(`Transaction ${existingTransaction._id} updated to FAILED`);

    return;
  }
}
