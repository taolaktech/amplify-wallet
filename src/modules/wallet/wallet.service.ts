import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Model, ObjectId, startSession, Types } from 'mongoose';
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
import { DebitCampaignDto } from './dto/debit-campaign.dto';
import { AppConfigService } from '../config/config.service';

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
    private readonly configService: AppConfigService,
  ) {}

  async listCreditsTopUpPacks(): Promise<
    Array<{
      priceId: string;
      tokens: number;
      unitAmount: number | null;
      currency: string | null;
    }>
  > {
    const topUpPacks = this.configService.getTopUpPackPrices();
    const entries = Object.values(topUpPacks);

    const uniquePriceIds = Array.from(new Set(entries.map((e) => e.priceId)));

    const prices = await Promise.all(
      uniquePriceIds.map((id) =>
        this.stripe.prices
          .retrieve(id)
          .catch(() => null as unknown as Stripe.Price | null),
      ),
    );

    const priceById = new Map<string, Stripe.Price>();
    for (const p of prices) {
      if (p && typeof p.id === 'string') {
        priceById.set(p.id, p);
      }
    }

    return entries.map((e) => {
      const stripePrice = priceById.get(e.priceId);
      return {
        priceId: e.priceId,
        tokens: e.tokens,
        unitAmount:
          typeof stripePrice?.unit_amount === 'number'
            ? stripePrice.unit_amount
            : null,
        currency:
          typeof stripePrice?.currency === 'string'
            ? stripePrice.currency
            : null,
      };
    });
  }

  async createCreditsCheckoutSession(params: {
    user: UserDoc;
    origin?: string;
    priceId?: string;
  }): Promise<string> {
    const { user, origin, priceId: selectedPriceId } = params;

    if (!user?.stripeCustomerId) {
      throw new BadRequestException('Stripe customer not found for user');
    }

    try {
      const topUpPacks = this.configService.getTopUpPackPrices();
      const allowedPriceIds = new Set(
        Object.values(topUpPacks).map((p) => p.priceId),
      );

      let priceIdToUse: string | undefined = selectedPriceId;
      if (priceIdToUse && !allowedPriceIds.has(priceIdToUse)) {
        throw new BadRequestException('Invalid priceId');
      }

      if (!priceIdToUse) {
        const fallback = Object.values(topUpPacks)[0]?.priceId;
        if (!fallback) {
          throw new BadRequestException('No top-up packs are configured');
        }
        priceIdToUse = fallback;
      }

      const stripePrice = await this.stripe.prices.retrieve(priceIdToUse);
      const isOneTime =
        stripePrice?.type === 'one_time' && !stripePrice?.recurring;
      if (!isOneTime) {
        throw new BadRequestException(
          'Selected price must be a one-time price (not recurring)',
        );
      }

      const baseUrl = origin || 'http://localhost:3000';

      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        customer: user.stripeCustomerId,
        line_items: [{ price: priceIdToUse, quantity: 1 }],
        success_url: `${baseUrl}/settings/usage?checkout=success`,
        cancel_url: `${baseUrl}/settings/usage?checkout=cancel`,
        client_reference_id: user._id.toString(),
        metadata: {
          userId: user._id.toString(),
          reason: 'top_up_pack',
        },
      });

      if (!session.url) {
        throw new InternalServerErrorException(
          'Stripe checkout session created without a redirect URL',
        );
      }

      return session.url;
    } catch (error) {
      const stripeMessage =
        typeof error?.message === 'string' ? error.message : null;
      this.logger.error(
        `Failed to create credits checkout session for user ${user._id}: ${stripeMessage || 'Unknown error'}`,
        error?.stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        stripeMessage || 'Failed to create checkout session',
      );
    }
  }

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
            this.logger.log(
              `::: Topping up user ${user._id.toString()} with amount ${walletTopUpBody.amount * 100} :::`,
            );
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

            // Find user's wallet, or create it if it doesn't exist
            let wallet = await this.walletModel
              .findOne({ userId: user._id.toString() })
              .session(session);

            if (!wallet) {
              this.logger.log(
                `::: Wallet not found for user ${user._id}, creating one. :::`,
              );
              const [createdWallet] = await this.walletModel.create(
                [
                  {
                    userId: user._id.toString(),
                    status: 'ACTIVE',
                    balance: 0,
                  },
                ],
                { session },
              );

              await this.userModel.findByIdAndUpdate(
                user._id,
                { walletId: createdWallet._id },
                { session },
              );
              wallet = createdWallet;
            }

            // increment the user's wallet balance
            const updateResult = await this.walletModel.updateOne(
              { _id: wallet._id },
              { $inc: { balance: walletTopUpBody.amount * 100 } },
              { session },
            );

            // Crucial logging to diagnose the issue
            this.logger.log(
              `::: Wallet balance update result for user ${user._id}: ${JSON.stringify(updateResult)} :::`,
            );

            // If no document was matched, it means something went wrong with the update
            if (updateResult.matchedCount === 0) {
              this.logger.error(
                `::: Wallet for user ${user._id} could not be found or updated. Wallet was not topped up. :::`,
              );
              throw new InternalServerErrorException(
                'User wallet not found or could not be updated.',
              );
            }

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

  /**
   * Debit a user's wallet for a campaign
   * @param debitData
   * @returns Transaction details and remaining balance
   */
  async debitWalletForCampaign(
    debitData: DebitCampaignDto & { idempotencyKey: string },
  ): Promise<{
    transactionId: string;
    remainingBalance: number;
  }> {
    const session = await this.connection.startSession();

    try {
      // Business validation
      if (debitData.amountInCents < 100) {
        throw new BadRequestException({
          message: 'Minimum debit amount is $1.00',
          code: 'INVALID_AMOUNT',
        });
      }

      // Check for duplicate transaction
      const existingTransaction = await this.transactionModel.findOne({
        userId: debitData.userId,
        idempotencyKey: debitData.idempotencyKey, // we are using the pregenearated campaignId from amplify-manager as idempotency key
      });

      if (existingTransaction) {
        this.logger.warn(
          `::: Duplicate transaction attempt for idempotency key ${debitData.idempotencyKey} :::`,
        );
        throw new BadRequestException({
          message: 'Duplicate transaction',
          code: 'DUPLICATE_TRANSACTION',
        });
      }

      // Validate ObjectId format before querying
      if (!Types.ObjectId.isValid(debitData.userId)) {
        throw new BadRequestException({
          message: 'Invalid user ID format',
          code: 'INVALID_USER_ID',
        });
      }

      // Get current wallet state for metadata
      let userWallet = await this.walletModel.findOne({
        userId: debitData.userId.toString(),
      });

      if (!userWallet) {
        // create a new wallet for the
        // throw new BadRequestException({
        //   message: 'Wallet not found',
        //   code: 'WALLET_NOT_FOUND',
        // });
        this.logger.error('Wallet not found');

        userWallet = await this.createWalletForUser(debitData.userId);
      }

      if (userWallet.status !== 'ACTIVE') {
        throw new BadRequestException({
          message: 'Wallet is not active',
          code: 'WALLET_INACTIVE',
        });
      }

      session.startTransaction();

      // Atomic wallet debit with balance check to prevent race conditions
      const walletUpdateResult = await this.walletModel.updateOne(
        {
          _id: userWallet._id,
          balance: { $gte: debitData.amountInCents }, //  balance check
          status: 'ACTIVE',
        },
        {
          $inc: { balance: -debitData.amountInCents },
        },
        { session },
      );

      if (walletUpdateResult.matchedCount === 0) {
        throw new BadRequestException({
          message: 'Insufficient wallet balance or wallet inactive',
          code: 'INSUFFICIENT_FUNDS',
        });
      }

      // Create completed transaction with metadata
      const [createdTransaction] = await this.transactionModel.create(
        [
          {
            userId: debitData.userId,
            type: TRANSACTION_TYPE.CAMPAIGN_DEBIT,
            amount: debitData.amountInCents,
            status: TRANSACTION_STATUS.COMPLETED,
            idempotencyKey: debitData.idempotencyKey,
            metadata: {
              campaignId: debitData.idempotencyKey,
              originalBalance: userWallet.balance,
              newBalance: userWallet.balance - debitData.amountInCents,
              timestamp: new Date(),
              operation: 'CAMPAIGN_DEBIT',
            },
          },
        ],
        { session },
      );

      await session.commitTransaction();

      this.logger.log(
        `::: Successfully debited ${debitData.amountInCents} cents for user ${debitData.userId} :::`,
      );

      return {
        transactionId: createdTransaction._id.toString(),
        remainingBalance: userWallet.balance - debitData.amountInCents,
      };
    } catch (error) {
      this.logger.error(
        `::: Error debiting wallet for campaign => ${error.message} :::`,
        error.stack,
      );
      // check if the session variable is undefined, so we dont
      // call a function on an undefined variable
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      }

      this.logger.error(
        `::: Error debiting wallet for campaign => ${error.message} :::`,
        error.stack,
      );

      // Re-throw BadRequestExceptions as-is for business logic errors
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        throw new InternalServerErrorException('Database operation failed');
      }

      throw new InternalServerErrorException(
        'Failed to debit wallet for campaign',
      );
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }

  /**
   * create a new wallet for the user and link back to the user
   * on the user model
   * @param userId
   */
  async createWalletForUser(userId: string) {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new NotFoundException({
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // create wallet
    const createdWallet = await this.walletModel.create({
      userId: user._id.toString(),
      status: 'ACTIVE',
    });

    // update user with wallet Id
    await this.userModel.findByIdAndUpdate(user._id, {
      walletId: createdWallet._id,
    });

    return createdWallet;
  }

  async fetchWalletBalance(userId: Types.ObjectId) {
    let wallet = await this.walletModel.findOne({
      userId: userId.toString(),
    });

    if (!wallet) {
      this.logger.log(
        `::: No wallet found for user ${userId.toString()}, creating a new wallet :::`,
      );
      wallet = await this.createWalletForUser(userId.toString());
    }

    return wallet;
  }
}
