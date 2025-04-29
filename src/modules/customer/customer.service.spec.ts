import { Test, TestingModule } from '@nestjs/testing';
import { StripeCustomerService } from './customer.service';

describe('CustomerService', () => {
  let service: StripeCustomerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StripeCustomerService],
    }).compile();

    service = module.get<StripeCustomerService>(StripeCustomerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
