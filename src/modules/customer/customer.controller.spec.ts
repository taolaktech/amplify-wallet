import { Test, TestingModule } from '@nestjs/testing';
import { StripeCustomerController } from './customer.controller';

describe('CustomerController', () => {
  let controller: StripeCustomerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StripeCustomerController],
    }).compile();

    controller = module.get<StripeCustomerController>(StripeCustomerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
