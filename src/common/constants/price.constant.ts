export const PRODUCT_PLANS = {
  free: {
    monthly: 'price_1RJOC84K0EUJXpsuHnFOBtZf',
  },
  starter: {
    monthly: 'price_1RJOIF4K0EUJXpsuXoWVsLvI',
    quarterly: 'price_1RJOsq4K0EUJXpsut6AGoSqQ',
    annual: 'price_1RJOvK4K0EUJXpsu9JjKZk5q',
  },
  grow: {
    monthly: 'price_1RJORI4K0EUJXpsuA3Uc1yff',
    quarterly: 'price_1RJOzX4K0EUJXpsuhbvXdRFy',
    annual: 'price_1RJP0t4K0EUJXpsuGrlrCi0Z',
  },
  scale: {
    monthly: 'price_1RJOWj4K0EUJXpsuQ3rqPxEU',
    quarterly: 'price_1RJP4F4K0EUJXpsupXziADUr',
    annual: 'price_1RJP5L4K0EUJXpsuP0J14AlF',
  },
};

type PlanName = keyof typeof PRODUCT_PLANS;

/*
 * function that takes in price id and returns the plan tier/name
 */
export function getPlanName(priceId: string): PlanName | 'Unknown' {
  const plan = Object.keys(PRODUCT_PLANS).find((plan) => {
    return Object.values(PRODUCT_PLANS[plan as PlanName]).includes(priceId);
  });

  return (plan as PlanName) || 'Unknown';
}
