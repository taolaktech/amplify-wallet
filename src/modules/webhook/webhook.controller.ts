import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  Headers,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller('stripe/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Headers('stripe-signature') signature: string, // Get the Stripe signature from headers
    @Req() request: RawBodyRequest<Request>, // Use RawBodyRequest<Request> to access rawBody
  ) {
    // this.logger.log(`Webhook request received. Passing to WebhookService.`);
    await this.webhookService.handleIncomingEvent(signature, request.rawBody);

    return { received: true };
  }
}
