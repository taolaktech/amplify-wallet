import { Module } from '@nestjs/common';
import { StripeCustomerService } from './customer.service';
import { StripeCustomerController } from './customer.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { StripeModule } from '../stripe/stripe.module';
import { AuthService } from '../auth/auth.service';
import { InternalHttpHelper } from '../../common/helpers/internal-http.helper';
import { ServiceRegistryService } from '../../common/services/service-registry.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    StripeModule,
  ],
  providers: [
    StripeCustomerService,
    AuthService,
    InternalHttpHelper,
    ServiceRegistryService,
  ],
  controllers: [StripeCustomerController],
})
export class CustomerModule {}
