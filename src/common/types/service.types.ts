export const ServiceNames = {
  AMPLIFY_MANAGER: 'amplify-manager',
  AMPLIFY_WALLET: 'amplify-wallet',
} as const;

export type ServiceName = (typeof ServiceNames)[keyof typeof ServiceNames];
