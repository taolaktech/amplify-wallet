import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from 'src/common/types/transaction.types';
import { ApiProperty } from '@nestjs/swagger';

export type TransactionDocument = HydratedDocument<Transaction>;

@Schema({ timestamps: true })
export class Transaction {
  @ApiProperty({
    type: String,
    description: 'The ID of the user associated with the transaction',
    example: '60c72b2f9b1e8b0015f8e5b1',
  })
  @Prop({ type: Types.ObjectId, ref: 'users', required: true })
  userId: Types.ObjectId;

  @ApiProperty({
    enum: TRANSACTION_TYPE,
    description: 'The type of transaction (e.g., TOP_UP, CAMPAIGN_DEBIT)',
    example: TRANSACTION_TYPE.TOP_UP,
  })
  @Prop({
    type: String,
    enum: ['TOP_UP', 'CAMPAIGN_DEBIT', 'REFUND'],
    required: true,
  })
  type: string;

  @ApiProperty({
    type: Number,
    description: 'The amount of the transaction in cents',
    example: 10000, // $100.00
  })
  @Prop({ type: Number, required: true })
  amount: number; // In cents

  @ApiProperty({
    enum: TRANSACTION_STATUS,
    description: 'The current status of the transaction',
    example: TRANSACTION_STATUS.COMPLETED,
  })
  @Prop({
    type: String,
    enum: ['PENDING', 'COMPLETED', 'FAILED'],
    required: true,
  })
  status: string;

  @ApiProperty({
    type: String,
    description:
      'Unique key to prevent duplicate transactions (for client-initiated actions)',
    required: false,
    example: 'your_unique_idempotency_key_123',
  })
  @Prop({ type: String, index: true, unique: true, sparse: true })
  idempotencyKey?: string; // For top-ups and other client-initiated actions

  @ApiProperty({
    type: 'object',
    description: 'Additional metadata related to the transaction',
    additionalProperties: true,
    // required?: false,
    example: { paymentIntentId: 'pi_abc123', someOtherDetail: 'value' },
  })
  @Prop({ type: Object }) // To store related info, e.g., { campaignId: '...' }
  metadata?: Record<string, any>;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
