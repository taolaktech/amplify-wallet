import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Model, startSession } from 'mongoose';
import {
  TransactionDocument,
  User,
  UserDoc,
  WalletDocument,
} from '../../database/schema';
import Stripe from 'stripe';
import { WalletTopUpDto } from './dto/wallet-top-up.dto';
import {
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from 'src/common/types/transaction.types';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel('users') private userModel: Model<UserDoc>,
    @InjectModel('transactions')
    private transactionModel: Model<TransactionDocument>,
    @InjectModel('wallets') private walletModel: Model<WalletDocument>,
    @InjectConnection() private readonly connection: mongoose.Connection,
    @Inject('STRIPE_CLIENT') private stripe: Stripe,
  ) {}

  async topUpWallet(
    user: UserDoc,
    idempotencyKey: string,
    walletTopUpBody: WalletTopUpDto,
  ): Promise<
    | TransactionDocument
    | { status: string; paymentIntentId: string; clientSecret?: string }
  > {
    try {
      if (!idempotencyKey) {
        throw new Error('Idempotency key is required');
      }

      // check if a transaction with the same idempotency key already exists
      const existingTransaction = await this.transactionModel.findOne({
        idempotencyKey,
        status: TRANSACTION_STATUS.COMPLETED,
      });

      // this.logger.log(
      //   `:: existing ${existingTransaction ? 'found' : 'not found'} => ${JSON.stringify(existingTransaction)}`,
      // );

      // if transaction exists, return it
      if (existingTransaction) {
        this.logger.log(
          `::: Transaction with idempotency key ${idempotencyKey} already exists :::`,
        );
        return existingTransaction as TransactionDocument;
      }

      const paymentIntentData: Stripe.PaymentIntentCreateParams = {
        amount: walletTopUpBody.amount * 100,
        currency: 'usd',
        payment_method: walletTopUpBody.paymentMethodId,
        confirm: true, //  tells Stripe to charge the card immediately.
        off_session: true,
        customer: user.stripeCustomerId,
      };

      // create payment intent in a try/catch block
      let paymentIntent: Stripe.Response<Stripe.PaymentIntent>;
      try {
        paymentIntent =
          await this.stripe.paymentIntents.create(paymentIntentData);

        if (paymentIntent.status === 'succeeded') {
          this.logger.log(
            `::: Payment intent with idempotency key ${idempotencyKey} succeeded :::`,
          );
          // start a mongoose session
          const session = await this.connection.startSession();
          try {
            this.logger.log(
              `::: Starting wallet top up database transaction for user ${user._id} :::`,
            );
            // start a mongoose transaction
            session.startTransaction();
            // create a transaction with status COMPLETED
            const createdTransaction = (await this.transactionModel.create(
              [
                {
                  idempotencyKey,
                  status: TRANSACTION_STATUS.COMPLETED,
                  amount: walletTopUpBody.amount * 100,
                  type: TRANSACTION_TYPE.TOP_UP,
                  userId: user._id,
                  metadata: {
                    paymentIntentId: paymentIntent.id,
                    response: JSON.stringify(paymentIntent),
                  },
                },
              ],
              { session },
            )) as unknown as TransactionDocument;

            // increment the user's wallet balance
            await this.walletModel.findOneAndUpdate(
              { userId: user._id },
              { $inc: { balance: walletTopUpBody.amount * 100 } },
              { session },
            );

            // commit the transaction
            await session.commitTransaction();
            this.logger.log(
              `::: Wallet top up transaction for user ${user._id} completed successfully :::`,
            );
            return createdTransaction;
          } catch (error) {
            // rollback the transaction
            this.logger.error(
              `::: Database transaction operation failed => ${error} :::`,
            );
            await session.abortTransaction();
            throw error;
          } finally {
            await session.endSession();
          }
        } else if (
          paymentIntent.status === 'requires_action' ||
          paymentIntent.status === 'processing'
        ) {
          // create PENDING transaction
          await this.transactionModel.create({
            idempotencyKey,
            status: TRANSACTION_STATUS.PENDING,
            amount: walletTopUpBody.amount * 100,
            type: TRANSACTION_TYPE.TOP_UP,
            userId: user._id,
            metadata: {
              paymentIntentId: paymentIntent.id,
            },
          });

          return {
            status: paymentIntent.status,
            paymentIntentId: paymentIntent.id,
            /*
             * The frontend will use this clientSecret with the Stripe.js library (stripe.handleNextAction())
             * The client secret is used to render a payment form on the client side.
             */
            clientSecret: paymentIntent.client_secret,
          };
        } else if (paymentIntent.status === 'requires_payment_method') {
          // create a FAILED transaction and store the response in the metadata
          await this.transactionModel.create({
            idempotencyKey,
            status: TRANSACTION_STATUS.FAILED,
            amount: walletTopUpBody.amount * 100,
            type: TRANSACTION_TYPE.TOP_UP,
            userId: user._id,
            metadata: {
              errorMessage: paymentIntent.last_payment_error.message,
            },
          });

          // throw a bad request exception error with a clear error message
          throw new BadRequestException(
            'Your card was declined. Please try a different payment method',
          );
        }
      } catch (error) {
        // check if error is an instance of HttpException and rethrow it
        if (error instanceof HttpException) {
          throw error;
        }

        // create a transaction with status FAILED
        await this.transactionModel.create({
          idempotencyKey,
          status: TRANSACTION_STATUS.FAILED,
          amount: walletTopUpBody.amount * 100,
          type: TRANSACTION_TYPE.TOP_UP,
          userId: user._id,
        });

        throw new Error('Failed to top up wallet');
      }
    } catch (error) {
      this.logger.error('Error toping up wallet:', error);
      const message = error.message ?? 'Failed to top up wallet';

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(message);
    }
  }
}
