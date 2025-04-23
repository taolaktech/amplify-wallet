import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';
import Stripe from 'stripe';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UserDocument } from '../../common/interfaces/request.interface';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
  ) {}

  async createStripeCustomer(customer: CreateCustomerDto): Promise<any> {
    try {
      // 1) create in Stripe
      const stripeCustomer = await this.stripe.customers.create({
        email: customer.email,
        name: customer.name,
        ...(Object.keys(customer.metadata).length > 0
          ? { metadata: customer.metadata }
          : {}),
      });

      // 2) persist locally
      const customerData = new this.customerModel({
        userId: customer._id,
        stripeCustomerId: stripeCustomer.id,
        firebaseUserId: customer.firebaseUserId,
        email: stripeCustomer.email,
        name: stripeCustomer.name,
        phone: stripeCustomer.phone,
        address: stripeCustomer.address,
        metadata: stripeCustomer.metadata,
        created: stripeCustomer.created,
        defaultPaymentMethod: stripeCustomer.invoice_settings
          .default_payment_method as string,
        invoiceSettings: stripeCustomer.invoice_settings,
        currency: stripeCustomer.currency,
        livemode: stripeCustomer.livemode,
        delinquent: stripeCustomer.delinquent,
      });

      const newStripeCustomer = await customerData.save();

      return newStripeCustomer;
    } catch (error) {
      const message = error?.message ?? 'Error creating customer';
      this.logger.log(`::: Error creating customer: ${error} :::`);
      throw new BadRequestException(message, {
        cause: error,
        description: 'Error creating customer',
      });
    }
  }

  async getCustomer(customerId: string): Promise<Customer> {
    try {
      const customer = await this.customerModel.findOne({ userId: customerId });

      return customer;
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
    userData: UserDocument,
  ): Promise<Customer> {
    try {
      // 1) Find the customer in our database
      const customer = await this.customerModel.findOne({ userId });

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

      // 4) Update our local database
      // Map Stripe response to our database model
      const updatedFields = {
        email: updatedStripeCustomer.email,
        name: updatedStripeCustomer.name,
        phone: updatedStripeCustomer.phone,
        address: updatedStripeCustomer.address,
        metadata: updatedStripeCustomer.metadata,
        defaultPaymentMethod: updatedStripeCustomer.invoice_settings
          ?.default_payment_method as string,
        invoiceSettings: updatedStripeCustomer.invoice_settings,
        shipping: updatedStripeCustomer.shipping,
      };

      // Update the customer in our database
      const updatedCustomer = await this.customerModel.findOneAndUpdate(
        { userId },
        { $set: updatedFields },
        { new: true }, // Return the updated document
      );

      if (!updatedCustomer) {
        throw new Error('Failed to update customer in database');
      }

      return updatedCustomer;
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
   * Deletes a customer from both Stripe and the local database
   * @param userId The ID of the user whose customer record should be deleted
   * @returns A success message
   * @throws NotFoundException if the customer doesn't exist
   * @throws BadRequestException if there's an error during deletion
   */
  async deleteCustomer(userId: string): Promise<{ success: boolean }> {
    try {
      // 1) Find the customer in our database
      const customer = await this.customerModel.findOne({ userId });

      if (!customer) {
        throw new NotFoundException(
          `Customer not found for user ID: ${userId}`,
        );
      }

      // 2) Delete the customer from Stripe
      try {
        await this.stripe.customers.del(customer.stripeCustomerId);
        this.logger.log(
          `Deleted customer ${customer.stripeCustomerId} from Stripe`,
        );
      } catch (stripeError) {
        // If the customer doesn't exist in Stripe, we can still proceed with local deletion
        if (stripeError.code === 'resource_missing') {
          this.logger.warn(
            `Customer ${customer.stripeCustomerId} not found in Stripe, proceeding with local deletion`,
          );
        } else {
          // For other Stripe errors, abort the operation
          throw stripeError;
        }
      }

      // 3) Delete the customer from our database
      const deleteResult = await this.customerModel.deleteOne({ userId });

      if (deleteResult.deletedCount === 0) {
        throw new Error('Failed to delete customer from database');
      }

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
