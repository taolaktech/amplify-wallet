import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type UserDoc = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ unique: true })
  email: string;

  @Prop()
  firstName: string;

  @Prop()
  lastName: string;

  @Prop()
  name: string;

  @Prop()
  photoUrl: string;

  @Prop({ unique: true })
  firebaseUserId: string;

  @Prop()
  otp: string;

  @Prop({ type: Date })
  otpExpiryDate: Date;

  @Prop()
  signUpMethod: string;

  @Prop()
  passwordChangedAt?: Date;

  // Added Stripe-related fields
  @Prop({ unique: true, sparse: true })
  stripeCustomerId?: string;

  @Prop()
  defaultPaymentMethod?: string;

  @Prop({ default: false })
  hasActiveSubscription?: boolean;

  @Prop({ type: Date })
  lastStripeSync?: Date;

  @Prop({ enum: ['active', 'past_due', 'canceled', 'none'], default: 'none' })
  paymentStatus?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);


