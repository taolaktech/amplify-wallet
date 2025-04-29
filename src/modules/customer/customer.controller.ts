import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ApiTags, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import Stripe from 'stripe';
import { UserDoc } from './schemas/user.schema';

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

  @Get('me')
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

  @Delete('me')
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
}
