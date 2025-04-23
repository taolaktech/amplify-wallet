import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Define Address schema
@Schema({ _id: false })
export class Address {
  @Prop()
  line1?: string;

  @Prop()
  line2?: string;

  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop()
  postal_code?: string;

  @Prop()
  country?: string;
}

// Define Shipping schema
@Schema({ _id: false })
export class Shipping {
  @Prop()
  name?: string;

  @Prop()
  phone?: string;

  @Prop({ type: Address })
  address: Address;
}

export type CustomerDocument = Customer & Document;

@Schema({ timestamps: true })
export class Customer extends Document {
  @Prop({ required: true, unique: true })
  userId: string; // internal user ID

  @Prop({ required: true, unique: true })
  stripeCustomerId: string;

  @Prop({ required: true })
  firebaseUserId: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  created: number;

  @Prop({ required: false })
  phone?: string;

  @Prop({ required: false, type: Object })
  metadata?: Record<string, any>;

  @Prop({ required: false })
  defaultPaymentMethod?: string;

  @Prop({ required: false, type: Object })
  invoiceSettings?: Record<string, any>;

  @Prop({ required: false, type: Boolean })
  delinquent?: boolean;

  @Prop({ required: false })
  currency?: string;

  @Prop({ required: false, type: Boolean })
  livemode?: boolean;

  @Prop({ type: Address })
  address?: Address;

  @Prop({ type: Shipping })
  shipping?: Shipping;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
