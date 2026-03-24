import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import type { AppConfig } from './config.schema';
import { PlanTier } from 'src/database/schema';

export type PlanPeriod = 'monthly' | 'quarterly' | 'annual';
export type TopUpPackName = 'top_up_1000' | 'top_up_2000' | 'top_up_4000';

@Injectable()
export class AppConfigService {
  constructor(private configService: NestConfigService<AppConfig>) {}

  get<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
    const value = this.configService.get<AppConfig[K]>(key);
    if (value === undefined || value === null) {
      throw new Error(`Config key "${String(key)}" is not defined`);
    }
    return value as NonNullable<AppConfig[K]>;
  }

  getProductPrices() {
    const productPlans: Record<PlanTier, Record<PlanPeriod, string>> = {
      starter: {
        monthly: this.get('STARTER_MONTHLY_PRICE_ID'),
        quarterly: this.get('STARTER_QUARTERLY_PRICE_ID'),
        annual: this.get('STARTER_YEARLY_PRICE_ID'),
      },
      grow: {
        monthly: this.get('GROW_MONTHLY_PRICE_ID'),
        quarterly: this.get('GROW_QUARTERLY_PRICE_ID'),
        annual: this.get('GROW_YEARLY_PRICE_ID'),
      },
      scale: {
        monthly: this.get('SCALE_MONTHLY_PRICE_ID'),
        quarterly: this.get('SCALE_QUARTERLY_PRICE_ID'),
        annual: this.get('SCALE_YEARLY_PRICE_ID'),
      },
    };
    return productPlans;
  }

  getProductTokens() {
    const productTokens: Record<
      PlanTier,
      Record<PlanPeriod | 'trial', number>
    > = {
      starter: {
        monthly: this.get('STARTER_MONTHLY_TOKENS'),
        quarterly: this.get('STARTER_QUARTERLY_TOKENS'),
        annual: this.get('STARTER_YEARLY_TOKENS'),
        trial: this.get('STARTER_TRIAL_TOKENS'),
      },
      grow: {
        monthly: this.get('GROW_MONTHLY_TOKENS'),
        quarterly: this.get('GROW_QUARTERLY_TOKENS'),
        annual: this.get('GROW_YEARLY_TOKENS'),
        trial: this.get('GROW_TRIAL_TOKENS'),
      },
      scale: {
        monthly: this.get('SCALE_MONTHLY_TOKENS'),
        quarterly: this.get('SCALE_QUARTERLY_TOKENS'),
        annual: this.get('SCALE_YEARLY_TOKENS'),
        trial: this.get('SCALE_TRIAL_TOKENS'),
      },
    };
    return productTokens;
  }

  getTopUpPackPrices() {
    const topUpPrices: Record<
      TopUpPackName,
      { priceId: string; tokens: number }
    > = {
      top_up_1000: {
        priceId: this.get('TOP_UP_PACK_1000_PRICE_ID'),
        tokens: this.get('TOP_UP_PACK_1000_TOKENS'),
      },
      top_up_2000: {
        priceId: this.get('TOP_UP_PACK_2000_PRICE_ID'),
        tokens: this.get('TOP_UP_PACK_2000_TOKENS'),
      },
      top_up_4000: {
        priceId: this.get('TOP_UP_PACK_4000_PRICE_ID'),
        tokens: this.get('TOP_UP_PACK_4000_TOKENS'),
      },
    };
    return topUpPrices;
  }

  getPlanInfo(priceId: string): {
    planTier: PlanTier | 'unknown';
    period: PlanPeriod | 'unknown';
    tokens: number;
  } {
    // get the number of token for the priceId passed
    const productPriceIds = this.getProductPrices();
    let tokens = 0;
    let planTier: PlanTier | 'unknown' = 'unknown';
    let period: PlanPeriod | 'unknown' = 'unknown';

    Object.keys(productPriceIds).forEach((p) => {
      Object.keys(productPriceIds[p]).forEach((period) => {
        if (productPriceIds[p][period] === priceId) {
          planTier = p as PlanTier;
          period = period as PlanPeriod;
          tokens = this.getProductTokens()[p][period];
        }
      });
    });

    return { planTier, period, tokens };
  }

  getSubscriptionTokens(params: {
    planTier: PlanTier;
    period: PlanPeriod;
    isTrial: boolean;
  }): number {
    const { planTier, period, isTrial } = params;
    return isTrial
      ? this.getProductTokens()[planTier].trial
      : this.getProductTokens()[planTier][period];
  }
}
