import { z } from 'zod';

const numberFromEnv = (fieldName: string) =>
  z.preprocess(
    (val) => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '' ? Number.NaN : Number(trimmed);
      }
      return typeof val === 'number' ? val : Number(val);
    },
    z
      .number({
        invalid_type_error: `${fieldName} must be a number`,
        required_error: `${fieldName} is required`,
      })
      .finite(`${fieldName} must be a valid number`),
  );

export const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test', 'staging'])
    .default('development'),

  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default('3333'),

  STRIPE_WEBHOOK_SECRET: z.string(),

  STARTER_MONTHLY_PRICE_ID: z.string(),
  STARTER_QUARTERLY_PRICE_ID: z.string(),
  STARTER_YEARLY_PRICE_ID: z.string(),

  GROW_MONTHLY_PRICE_ID: z.string(),
  GROW_QUARTERLY_PRICE_ID: z.string(),
  GROW_YEARLY_PRICE_ID: z.string(),

  SCALE_MONTHLY_PRICE_ID: z.string(),
  SCALE_QUARTERLY_PRICE_ID: z.string(),
  SCALE_YEARLY_PRICE_ID: z.string(),

  STARTER_MONTHLY_TOKENS: numberFromEnv('STARTER_MONTHLY_TOKENS'),
  STARTER_QUARTERLY_TOKENS: numberFromEnv('STARTER_QUARTERLY_TOKENS'),
  STARTER_YEARLY_TOKENS: numberFromEnv('STARTER_YEARLY_TOKENS'),
  STARTER_TRIAL_TOKENS: numberFromEnv('STARTER_TRIAL_TOKENS'),

  GROW_MONTHLY_TOKENS: numberFromEnv('GROW_MONTHLY_TOKENS'),
  GROW_QUARTERLY_TOKENS: numberFromEnv('GROW_QUARTERLY_TOKENS'),
  GROW_YEARLY_TOKENS: numberFromEnv('GROW_YEARLY_TOKENS'),
  GROW_TRIAL_TOKENS: numberFromEnv('GROW_TRIAL_TOKENS'),

  SCALE_MONTHLY_TOKENS: numberFromEnv('SCALE_MONTHLY_TOKENS'),
  SCALE_QUARTERLY_TOKENS: numberFromEnv('SCALE_QUARTERLY_TOKENS'),
  SCALE_YEARLY_TOKENS: numberFromEnv('SCALE_YEARLY_TOKENS'),
  SCALE_TRIAL_TOKENS: numberFromEnv('SCALE_TRIAL_TOKENS'),

  TOP_UP_PACK_1000_PRICE_ID: z.string(),
  TOP_UP_PACK_2000_PRICE_ID: z.string(),
  TOP_UP_PACK_4000_PRICE_ID: z.string(),

  TOP_UP_PACK_1000_TOKENS: numberFromEnv('TOP_UP_PACK_1000_TOKENS'),
  TOP_UP_PACK_2000_TOKENS: numberFromEnv('TOP_UP_PACK_2000_TOKENS'),
  TOP_UP_PACK_4000_TOKENS: numberFromEnv('TOP_UP_PACK_4000_TOKENS'),

  STARTER_MEMORY_LIMIT_MB: numberFromEnv('STARTER_MEMORY_LIMIT_MB'),
  GROW_MEMORY_LIMIT_MB: numberFromEnv('GROW_MEMORY_LIMIT_MB'),
  SCALE_MEMORY_LIMIT_MB: numberFromEnv('SCALE_MEMORY_LIMIT_MB'),
});

export type AppConfig = z.infer<typeof configSchema>;
