import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { StripeCustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ApiResult } from '../../common/interfaces/response.interface';
import { ExtendedRequest } from '../../common/interfaces/request.interface';
// import { Customer } from './schemas/customer.schema';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import Stripe from 'stripe';
import { UserDoc } from './schemas/user.schema';
import { SetDefaultPaymentMethodDto } from './dto/set-default-payment.dto';

@ApiTags('stripe-customers')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('stripe/customers')
export class StripeCustomerController {
  constructor(private readonly customerService: StripeCustomerService) {}

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: CreateCustomerDto, description: 'Stripe Customer details' })
  async createStripeCustomer(
    @Body() customerDetails: CreateCustomerDto,
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Stripe.Customer>> {
    const user = request['authenticatedData'];

    const customer = await this.customerService.createStripeCustomer(user);

    return {
      success: true,
      message: 'Stripe customer created successfully',
      data: customer,
    };
  }

  @Put('update')
  @HttpCode(HttpStatus.OK)
  @ApiBody({
    type: UpdateCustomerDto,
    description: 'Update Stripe Customer details',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Stripe customer updated successfully',
  })
  async updateStripeCustomer(
    @Body() updateData: UpdateCustomerDto,
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Stripe.Customer>> {
    const user = request['authenticatedData'];

    const updatedCustomer = await this.customerService.updateStripeCustomer(
      user._id.toString(),
      updateData,
      user,
    );

    return {
      success: true,
      message: 'Stripe customer updated successfully',
      data: updatedCustomer,
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Stripe customer retrieved successfully',
  })
  async getStripeCustomer(
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Stripe.Customer>> {
    const user = request['authenticatedData'];

    const customer = await this.customerService.getCustomer(
      user._id.toString(),
    );

    return {
      success: true,
      message: 'Customer retrieved successfully',
      data: customer,
    };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Stripe customer deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Stripe customer not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Error deleting stripe customer',
  })
  async deleteCustomer(
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<null>> {
    const user = request['authenticatedData'];

    const result = await this.customerService.deleteStripeCustomer(
      user._id.toString(),
    );

    return {
      success: result.success,
      message: 'Customer deleted successfully',
      data: null,
    };
  }

  @Get('/payment-methods')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "List authenticated user's saved payment methods (cards)",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment methods retrieved successfully.',
  })
  async listPaymentMethods(
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Stripe.PaymentMethod[]>> {
    const user = request['authenticatedData'];
    const paymentMethods = await this.customerService.listStripePaymentMethods(
      user._id.toString(),
    );
    return {
      success: true,
      message: 'Payment methods retrieved successfully.',
      data: paymentMethods.data, // Stripe list objects have a 'data' array
    };
  }

  @Post('/setup-intent')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a SetupIntent to add a new payment method' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'SetupIntent created successfully. Returns client_secret.',
  })
  async createSetupIntent(
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<{ clientSecret: string; stripeCustomerId: string }>> {
    const user = request['authenticatedData'];
    const result = await this.customerService.createStripeSetupIntent(
      user._id.toString(),
    );
    return {
      success: true,
      message:
        'SetupIntent created successfully. Use clientSecret on the frontend to confirm setup.',
      data: result,
    };
  }

  @Put('/payment-methods/set-default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a default payment method for the authenticated user',
  })
  @ApiBody({ type: SetDefaultPaymentMethodDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Default payment method updated successfully.',
  })
  async setDefaultPaymentMethod(
    @Req() request: ExtendedRequest,
    @Body() dto: SetDefaultPaymentMethodDto,
  ): Promise<ApiResult<Stripe.Customer>> {
    const user = request['authenticatedData'];
    const updatedCustomer =
      await this.customerService.setDefaultStripePaymentMethod(
        user._id.toString(),
        dto.paymentMethodId,
      );
    return {
      success: true,
      message: 'Default payment method updated successfully.',
      data: updatedCustomer, // Return the updated Stripe Customer object
    };
  }

  @Delete('/payment-methods/:pmId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detach (delete) a saved payment method' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Payment method detached successfully.',
  })
  async detachPaymentMethod(
    @Req() request: ExtendedRequest,
    @Param('pmId') paymentMethodIdToDelete: string,
  ): Promise<ApiResult<null>> {
    const user = request['authenticatedData'];
    await this.customerService.detachStripePaymentMethod(
      user._id.toString(),
      paymentMethodIdToDelete,
    );
    return {
      success: true,
      message: 'Payment method detached successfully.',
      data: null,
    };
  }
}
