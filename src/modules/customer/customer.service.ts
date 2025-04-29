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
}
