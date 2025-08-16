import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { WalletTopUpDto } from './dto/wallet-top-up.dto';
import { WalletTopUpResponseDto } from './dto/wallet-top-up-response.dto';
import { ExtendedRequest } from 'src/common/interfaces/request.interface';
import { ApiResult } from 'src/common/interfaces/response.interface';
import Stripe from 'stripe';
import { TransactionDocument } from 'src/database/schema';
import { AuthGuard } from 'src/common/guards/auth.guard';

interface TransactionPendingResponse {
  status: string;
  paymentIntentId: string;
  clientSecret?: string;
}

type TopUpResponse = TransactionDocument | TransactionPendingResponse;

@ApiTags('Wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('top-up')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Top up the user wallet balance' })
  @ApiHeader({
    name: 'idempotency-key',
    description: 'Unique key to prevent duplicate top-up requests',
    required: true,
  })
  @ApiBody({ type: WalletTopUpDto })
  @ApiResponse({
    status: 200,
    description: 'Wallet top-up successful',
    type: WalletTopUpResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request (e.g., card declined)',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  async topUp(
    @Req() request: ExtendedRequest,
    @Body() walletTopUp: WalletTopUpDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<ApiResult<TopUpResponse>> {
    const user = request['authenticatedData'];
    // const userId = user._id.toString();

    const topUpResult = await this.walletService.topUpWallet(
      user,
      idempotencyKey,
      walletTopUp,
    );

    return {
      data: Array.isArray(topUpResult) ? topUpResult[0] : topUpResult,
      message: 'Wallet top-up successful',
      success: true,
    };
  }

  @Get('balance')
  @UseGuards(AuthGuard) // Add this since you're using authenticated user data
  @ApiOperation({
    summary: 'Get user wallet balance',
    description:
      'Retrieve the current wallet balance for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved wallet balance',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
            userId: { type: 'string', example: '507f1f77bcf86cd799439012' },
            balance: {
              type: 'number',
              example: 150000,
              description: 'Balance in cents',
            },
            currency: { type: 'string', example: 'USD' },
            status: {
              type: 'string',
              enum: ['ACTIVE', 'FROZEN', 'CLOSED'],
              example: 'ACTIVE',
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        message: {
          type: 'string',
          example: "Successfully fetched user's balance",
        },
        success: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  async getWalletBalance(@Req() request: ExtendedRequest) {
    const user = request['authenticatedData'];

    const balance = await this.walletService.fetchWalletBalance(user._id);

    return {
      data: balance,
      message: "Successfully fetched user's balance",
      success: true,
    };
  }
}
