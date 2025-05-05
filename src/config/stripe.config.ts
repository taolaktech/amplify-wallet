// src/config/stripe.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_API_KEY,
}));
