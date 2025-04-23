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
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ApiResult } from '../../common/interfaces/response.interface';
import { ExtendedRequest } from '../../common/interfaces/request.interface';
import { Customer } from './schemas/customer.schema';
import { ApiTags, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: CreateCustomerDto, description: 'Stripe Customer details' })
  async createCustomer(
    @Body() customerDetails: CreateCustomerDto,
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Customer>> {
    const user = request['authenticatedData'];

    const customer = await this.customerService.createStripeCustomer({
      ...customerDetails,
      ...user,
    });

    return {
      success: true,
      message: 'Customer created successfully',
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
    description: 'Customer updated successfully',
  })
  async updateCustomer(
    @Body() updateData: UpdateCustomerDto,
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Customer>> {
    const user = request['authenticatedData'];

    const updatedCustomer = await this.customerService.updateStripeCustomer(
      user._id,
      updateData,
      user,
    );

    return {
      success: true,
      message: 'Customer updated successfully',
      data: updatedCustomer,
    };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Customer retrieved successfully',
  })
  async getCustomer(
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<Customer>> {
    const user = request['authenticatedData'];

    const customer = await this.customerService.getCustomer(user._id);

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
    description: 'Customer deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Customer not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Error deleting customer',
  })
  async deleteCustomer(
    @Req() request: ExtendedRequest,
  ): Promise<ApiResult<null>> {
    const user = request['authenticatedData'];

    const result = await this.customerService.deleteCustomer(user._id);

    return {
      success: result.success,
      message: 'Customer deleted successfully',
      data: null,
    };
  }
}
