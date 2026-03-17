import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TokenTransactionDocument = HydratedDocument<TokenTransaction>;

export type TokenTransactionType = 'credit' | 'debit';
export type TokenTransactionReason =
  | 'generation'
  | 'refund'
  | 'subscription_topup';

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
    enum: ['generation', 'refund', 'subscription_topup'],
    index: true,
  })
  reason: TokenTransactionReason;

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  referenceId?: string;

  @Prop({
    type: Number,
    required: true,
  })
  balanceAfter: number;
}

export const TokenTransactionSchema = SchemaFactory.createForClass(
  TokenTransaction,
);
