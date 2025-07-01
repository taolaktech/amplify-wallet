import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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

  @Prop({ unique: true, sparse: true }) // Stores active sub ID like 'sub_...'
  stripeSubscriptionId?: string;

  @Prop() // Stores the Price ID of the active base plan like 'price_...'
  activeStripePriceId?: string;

  @Prop() // Stores Stripe status like 'active', 'trialing', 'past_due', 'canceled'
  subscriptionStatus?: string;

  @Prop({ type: Date }) // Stores end date of current billing cycle
  currentPeriodEnd?: Date;

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
