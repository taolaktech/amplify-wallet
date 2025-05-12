import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { StripeModule } from '../stripe/stripe.module';
import { SubscriptionController } from './subscription.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../customer/schemas/user.schema';
import { CustomerModule } from '../customer/customer.module';
import { AuthService } from '../auth/auth.service';
import { InternalHttpHelper } from '../../common/helpers/internal-http.helper';
import { ServiceRegistryService } from '../../common/services/service-registry.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    StripeModule,
    CustomerModule,
  ],
  providers: [
    AuthService,
    InternalHttpHelper,
    ServiceRegistryService,
    SubscriptionService,
  ],
  exports: [SubscriptionService],
  controllers: [SubscriptionController],
})
export class SubscriptionModule {}
