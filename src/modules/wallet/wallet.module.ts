import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { StripeModule } from '../stripe/stripe.module';
import { InternalHttpHelper } from 'src/common/helpers/internal-http.helper';
import { ServiceRegistryService } from 'src/common/services/service-registry.service';
import { AuthService } from '../auth/auth.service';
import { InternalWalletController } from './wallet.internal.controler';

@Module({
  imports: [StripeModule],
  providers: [
    WalletService,
    AuthService,
    InternalHttpHelper,
    ServiceRegistryService,
  ],
  controllers: [WalletController, InternalWalletController],
})
export class WalletModule {}
