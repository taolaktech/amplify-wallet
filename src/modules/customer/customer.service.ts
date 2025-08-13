import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDoc } from './schemas/user.schema';
import Stripe from 'stripe';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
// import { UserDocument } from '../../common/interfaces/request.interface';

@Injectable()
export class StripeCustomerService {
  private readonly logger = new Logger(StripeCustomerService.name);
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDoc>,
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
  ) {}

  async createStripeCustomer(customer: UserDoc): Promise<any> {
    try {
      // 1) Find the user in our database
      const user = await this.userModel.findById(customer._id);

      if (!user) {
        throw new NotFoundException(`User not found with ID: ${customer._id}`);
      }

      // 2) Check if user already has a Stripe customer ID
      if (user.stripeCustomerId) {
        // Return the existing Stripe customer
        return await this.getStripeCustomer(user.stripeCustomerId);
      }

      // 3) create in Stripe
      const stripeCustomer = await this.stripe.customers.create({
        email: customer.email,
        name: customer.name,
      });

      // 4) Update user with Stripe customer ID
      await this.userModel.findByIdAndUpdate(customer._id, {
        stripeCustomerId: stripeCustomer.id,
        lastStripeSync: new Date(),
        paymentStatus: 'none',
      });

      // 5) Return the Stripe customer data
      return stripeCustomer;
    } catch (error) {
      const message = error?.message ?? 'Error creating customer';
      this.logger.log(`::: Error creating customer: ${error} :::`);
      throw new BadRequestException(message, {
        cause: error,
        description: 'Error creating customer',
      });
    }
  }

  async getStripeCustomer(stripeCustomerId: string): Promise<Stripe.Customer> {
    try {
      // Fetch customer directly from Stripe
      return (await this.stripe.customers.retrieve(
        stripeCustomerId,
      )) as Stripe.Customer;
    } catch (error) {
      const message = error?.message ?? 'Error retrieving customer from Stripe';
      this.logger.error(
        `::: Error retrieving customer from Stripe: ${error} :::`,
      );
      throw new BadRequestException(message, {
        cause: error,
        description: 'Error retrieving customer from Stripe',
      });
    }
  }

  async getCustomer(userId: string): Promise<Stripe.Customer> {
    try {
      // 1) Find the user in our database
      const user = await this.userModel.findById(userId);

      if (!user) {
        throw new NotFoundException(`User not found with ID: ${userId}`);
      }

      if (!user.stripeCustomerId) {
        throw new NotFoundException(
          `No Stripe customer found for user ID: ${userId}`,
        );
      }

      // 2) Fetch customer directly from Stripe
      const stripeCustomer = await this.getStripeCustomer(
        user.stripeCustomerId,
      );

      // 3) Update last sync timestamp
      await this.userModel.findByIdAndUpdate(userId, {
        lastStripeSync: new Date(),
      });

      return stripeCustomer;
    } catch (error) {
      const message = error?.message ?? 'Error getting customer';
      this.logger.log(`::: Error getting customer: ${error} :::`);
      throw new BadRequestException(message, {
        cause: error,
        description: 'Error getting customer',
      });
    }
  }

  /**
   * Updates a customer's information in both Stripe and the local database.
   *
   * @param userId - The unique identifier of the user to update
   * @param updateData - DTO containing the customer update details
   * @param userData - The authenticated user's document
   * @returns The updated customer document
   * @throws {NotFoundException} If the customer is not found
   * @throws {BadRequestException} If there is an error during the update process
   */
  async updateStripeCustomer(
    userId: string,
    updateData: UpdateCustomerDto,
    userData: UserDoc,
  ): Promise<Stripe.Customer> {
    try {
      // 1) Find the customer in our database
      const customer = await this.userModel.findOne({ _id: userId });

      if (!customer) {
        throw new NotFoundException(
          `Customer not found for user ID: ${userId}`,
        );
      }

      // 2) Prepare update data for Stripe
      // Always use the authenticated user's email and name
      const stripeUpdateData: Stripe.CustomerUpdateParams = {
        email: userData.email,
        name: userData.name,
      };

      // Add optional fields from the DTO if they exist
      if (updateData.phone) stripeUpdateData.phone = updateData.phone;
      if (updateData.metadata) stripeUpdateData.metadata = updateData.metadata;
      if (updateData.address) stripeUpdateData.address = updateData.address;
      if (updateData.shipping) {
        // Only set shipping if address is provided
        if (updateData.shipping.address) {
          stripeUpdateData.shipping = {
            name: updateData.shipping.name || '',
            phone: updateData.shipping.phone || '',
            address: updateData.shipping.address,
          };
        } else {
          // If no address is provided, don't include shipping in the update
          this.logger.warn(
            'Shipping address is required when updating shipping information. Skipping shipping update.',
          );
        }
      }

      if (updateData.description)
        stripeUpdateData.description = updateData.description;

      // Handle default payment method separately as it's in invoice_settings
      if (updateData.defaultPaymentMethod) {
        stripeUpdateData.invoice_settings = {
          default_payment_method: updateData.defaultPaymentMethod,
        };
      }

      // 3) Update the customer in Stripe
      const updatedStripeCustomer = await this.stripe.customers.update(
        customer.stripeCustomerId,
        stripeUpdateData,
      );

      // 4) Update our user document with minimal Stripe info
      const updateFields = {
        lastStripeSync: new Date(),
      };

      if (updateData.defaultPaymentMethod) {
        updateFields['defaultPaymentMethod'] = updateData.defaultPaymentMethod;
      }

      await this.userModel.findByIdAndUpdate(userId, updateFields);

      return updatedStripeCustomer as Stripe.Customer;
    } catch (error) {
      const message = error?.message ?? 'Error updating customer';
      this.logger.error(`::: Error updating customer: ${error} :::`);
      throw new BadRequestException(message, {
        cause: error,
        description: 'Error updating customer',
      });
    }
  }

  /**
   * Deletes a customer from Stripe
   * @param userId The ID of the user whose customer record should be deleted
   * @returns A success message
   * @throws NotFoundException if the user or Stripe customer doesn't exist
   * @throws BadRequestException if there's an error during deletion
   */
  async deleteStripeCustomer(userId: string): Promise<{ success: boolean }> {
    try {
      // 1) Find the user in our database
      const user = await this.userModel.findById(userId);

      if (!user) {
        throw new NotFoundException(`User not found with ID: ${userId}`);
      }

      if (!user.stripeCustomerId) {
        throw new NotFoundException(
          `No Stripe customer found for user ID: ${userId}`,
        );
      }

      // 2) Delete the customer from Stripe
      try {
        await this.stripe.customers.del(user.stripeCustomerId);
        this.logger.log(
          `Deleted customer ${user.stripeCustomerId} from Stripe`,
        );
      } catch (stripeError) {
        // If the customer doesn't exist in Stripe, we can still proceed with local update
        if (stripeError.code === 'resource_missing') {
          this.logger.warn(
            `Customer ${user.stripeCustomerId} not found in Stripe, proceeding with local update`,
          );
        } else {
          // For other Stripe errors, abort the operation
          throw stripeError;
        }
      }

      // 3) Update the user to remove Stripe customer ID
      await this.userModel.findByIdAndUpdate(userId, {
        stripeCustomerId: null,
        defaultPaymentMethod: null,
        hasActiveSubscription: false,
        paymentStatus: 'none',
        lastStripeSync: new Date(),
      });

      return {
        success: true,
      };
    } catch (error) {
      // Handle specific error types
      if (error instanceof NotFoundException) {
        throw error;
      }

      const message = error?.message ?? 'Error deleting customer';
      this.logger.error(`Error deleting customer: ${error}`, error.stack);
      throw new BadRequestException(message, {
        cause: error,
        description: 'Error deleting customer',
      });
    }
  }

  async listStripePaymentMethods(
    userId: string,
  ): Promise<Stripe.ApiList<Stripe.PaymentMethod>> {
    this.logger.log(`Workspaceing payment methods for user ${userId}`);
    const user = await this.userModel
      .findById(userId)
      .select('stripeCustomerId')
      .exec();

    if (!user || !user.stripeCustomerId) {
      this.logger.warn(`User ${userId} not found or no Stripe customer ID.`);
      // Depending on UX, you might return an empty list or throw NotFound
      return { object: 'list', data: [], has_more: false, url: '' }; // Empty list
    }

    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: 'card', // Fetch only cards
      });

      this.logger.log(
        `Retrieved ${paymentMethods.data.length} payment methods for customer ${user.stripeCustomerId}`,
      );

      return paymentMethods;
    } catch (error) {
      this.logger.error(
        `Error listing payment methods for ${user.stripeCustomerId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Could not retrieve payment methods: ${error.message}`,
      );
    }
  }

  /**
   * Creates a Stripe SetupIntent for a user.
   *
   * @param userId - The ID of the user.
   * @returns A promise that resolves to an object containing the client secret and the Stripe customer ID.
   * @throws NotFoundException if the user with the given ID is not found.
   * @throws BadRequestException if the SetupIntent creation fails.
   */
  async createStripeSetupIntent(
    userId: string,
  ): Promise<{ clientSecret: string; stripeCustomerId: string }> {
    this.logger.log(`Creating SetupIntent for user ${userId}`);
    let user = await this.userModel
      .findById(userId)
      .select('stripeCustomerId')
      .exec();

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      this.logger.log(`User ${userId} has no Stripe ID. Creating one.`);
      const stripeCustomer = await this.createStripeCustomer(user); // Assuming createStripeCustomer updates the user model
      stripeCustomerId = stripeCustomer.id;
      user = await this.userModel
        .findById(userId)
        .select('stripeCustomerId')
        .exec(); // Re-fetch to ensure stripeCustomerId is available
    }

    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        usage: 'off_session', // Indicates you intend to use the PM when the customer is not present
      });

      this.logger.log(
        `Created SetupIntent ${setupIntent.id} for customer ${stripeCustomerId}`,
      );

      return { clientSecret: setupIntent.client_secret, stripeCustomerId };
    } catch (error) {
      this.logger.error(
        `Error creating SetupIntent for ${stripeCustomerId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Could not create SetupIntent: ${error.message}`,
      );
    }
  }

  /**
   * Sets the default Stripe payment method for a user.
   *
   * @param userId - The ID of the user.
   * @param paymentMethodId - The ID of the payment method to set as default.
   * @returns A Promise that resolves to the updated Stripe customer object.
   * @throws NotFoundException if the user is not found or has no Stripe customer ID.
   * @throws BadRequestException if the payment method does not belong to the customer or an error occurs while setting the default payment method.
   */
  async setDefaultStripePaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<Stripe.Customer> {
    this.logger.log(
      `Setting default payment method to ${paymentMethodId} for user ${userId}`,
    );

    const user = await this.userModel
      .findById(userId)
      .select('stripeCustomerId')
      .exec();

    if (!user || !user.stripeCustomerId) {
      throw new NotFoundException(
        `User ${userId} not found or no Stripe customer ID.`,
      );
    }

    try {
      // Verify the payment method belongs to the customer (optional but good check)
      const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.customer !== user.stripeCustomerId) {
        throw new BadRequestException(
          'Payment method does not belong to this customer.',
        );
      }

      const updatedStripeCustomer = await this.stripe.customers.update(
        user.stripeCustomerId,
        {
          invoice_settings: { default_payment_method: paymentMethodId },
        },
      );
      // Update local DB
      await this.userModel.findByIdAndUpdate(userId, {
        defaultPaymentMethod: paymentMethodId,
        lastStripeSync: new Date(),
      });

      this.logger.log(
        `Successfully set default PM for ${user.stripeCustomerId} to ${paymentMethodId}`,
      );

      return updatedStripeCustomer;
    } catch (error) {
      this.logger.error(
        `Error setting default PM for ${user.stripeCustomerId}: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Could not set default payment method: ${error.message}`,
      );
    }
  }

  async detachStripePaymentMethod(
    userId: string,
    paymentMethodIdToDelete: string,
  ): Promise<void> {
    this.logger.log(
      `Detaching payment method ${paymentMethodIdToDelete} for user ${userId}`,
    );
    const user = await this.userModel
      .findById(userId)
      .select('stripeCustomerId defaultPaymentMethod')
      .exec();
    if (!user || !user.stripeCustomerId) {
      throw new NotFoundException(
        `User ${userId} not found or no Stripe customer ID.`,
      );
    }

    try {
      // You can't detach a PM if it's set as the invoice_settings.default_payment_method for a customer.
      // You must first update the customer to remove the default PM or switch to a different one.
      const stripeCustomer = (await this.stripe.customers.retrieve(
        user.stripeCustomerId,
      )) as Stripe.Customer;
      if (
        stripeCustomer.invoice_settings?.default_payment_method ===
        paymentMethodIdToDelete
      ) {
        this.logger.log(
          `PM ${paymentMethodIdToDelete} is default. Clearing default PM for customer ${user.stripeCustomerId} first.`,
        );
        await this.stripe.customers.update(user.stripeCustomerId, {
          invoice_settings: { default_payment_method: null }, // Set to null or another PM
        });
        if (user.defaultPaymentMethod === paymentMethodIdToDelete) {
          await this.userModel.findByIdAndUpdate(userId, {
            defaultPaymentMethod: null,
            lastStripeSync: new Date(),
          });
        }
      }

      await this.stripe.paymentMethods.detach(paymentMethodIdToDelete);
      this.logger.log(`Successfully detached PM ${paymentMethodIdToDelete}`);

      // If the detached PM was the local default, clear it
      if (
        user.defaultPaymentMethod === paymentMethodIdToDelete &&
        stripeCustomer.invoice_settings?.default_payment_method !==
          paymentMethodIdToDelete
      ) {
        // Check again in case we didn't clear it above (e.g. customer was deleted or no longer exists)
        await this.userModel.findByIdAndUpdate(userId, {
          defaultPaymentMethod: null,
          lastStripeSync: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(
        `Error detaching PM ${paymentMethodIdToDelete}: ${error.message}`,
        error.stack,
      );
      // Stripe error 'payment_method_unexpected_state' if attached to active subscription
      if (error.code === 'payment_method_unexpected_state') {
        throw new BadRequestException(
          'Cannot detach payment method. It may be in use by an active subscription. Please update your subscription first.',
        );
      }
      throw new BadRequestException(
        `Could not detach payment method: ${error.message}`,
      );
    }
  }
}
