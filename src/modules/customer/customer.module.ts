import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { StripeModule } from '../stripe/stripe.module';
import { AuthService } from '../auth/auth.service';
import { InternalHttpHelper } from '../../common/helpers/internal-http.helper';
import { ServiceRegistryService } from '../../common/services/service-registry.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
    ]),
    StripeModule,
  ],
  providers: [
    CustomerService,
    AuthService,
    InternalHttpHelper,
    ServiceRegistryService,
  ],
  controllers: [CustomerController],
})
export class CustomerModule {}
