import {
  Body,
  Controller,
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
}
