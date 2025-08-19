import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

@Schema({ timestamps: true })
export class Wallet {
  @Prop({
    type: Types.ObjectId,
    ref: 'users',
    required: true,
    unique: true,
    index: true,
  })
  userId: string;

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  balance: number; //stored in cents

  @Prop({
    type: String,
    required: true,
    default: 'USD',
  })
  currency: string;

  @Prop({
    type: String,
    enum: ['ACTIVE', 'FROZEN', 'CLOSED'],
    default: 'ACTIVE',
  })
  status: string;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
