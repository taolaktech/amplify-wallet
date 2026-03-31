import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TokenTransactionDocument = HydratedDocument<TokenTransaction>;

export type TokenTransactionType = 'credit' | 'debit';
export type TokenTransactionReason =
  | 'generation'
  | 'generation_reserve'
  | 'generation_overage'
  | 'generation_reserve_refund'
  | 'subscription_topup'
  | 'top_up_pack';

@Schema({ timestamps: true })
export class TokenTransaction {
  @Prop({
    type: Types.ObjectId,
    ref: 'users',
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['credit', 'debit'],
    index: true,
  })
  type: TokenTransactionType;

  @Prop({
    type: Number,
    required: true,
  })
  amount: number;

  @Prop({
    type: String,
    required: true,
    enum: [
      'generation',
      'generation_reserve',
      'generation_overage',
      'generation_reserve_refund',
      'subscription_topup',
      'top_up_pack',
    ],
    index: true,
  })
  reason: TokenTransactionReason;

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  referenceId?: string; //invoice id from stripe

  @Prop({
    type: Types.ObjectId,
    ref: 'assets',
    required: false,
    index: true,
  })
  assetId?: Types.ObjectId;

  @Prop({
    type: Number,
    required: true,
  })
  balanceAfter: number;
}

export const TokenTransactionSchema =
  SchemaFactory.createForClass(TokenTransaction);

TokenTransactionSchema.index(
  { userId: 1, reason: 1, type: 1, referenceId: 1 },
  {
    unique: true,
    partialFilterExpression: { referenceId: { $type: 'string' } },
  },
);
