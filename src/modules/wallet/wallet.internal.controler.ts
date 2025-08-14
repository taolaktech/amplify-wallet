import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { InternalGuard } from 'src/common/guards/internal.guard';
import { DebitCampaignDto } from './dto/debit-campaign.dto';

@UseGuards(InternalGuard)
@Controller('api/internal/wallet')
export class InternalWalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('debit-for-campaign')
  async debitWalletForCampaign(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() debitData: DebitCampaignDto,
  ) {
    const transaction = await this.walletService.debitWalletForCampaign({
      ...debitData,
      idempotencyKey,
    });

    return {
      data: transaction,
      message: 'Successfully debited wallet for campaign',
      success: true,
    };
  }
}
