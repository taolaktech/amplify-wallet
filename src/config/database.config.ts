import { registerAs } from '@nestjs/config';
import { MongooseModuleOptions } from '@nestjs/mongoose';

export interface DatabaseConfig {
  uri: string;
  options: MongooseModuleOptions;
}

export default registerAs(
  'database',
  (): DatabaseConfig => ({
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/amplify-wallet',
    options: {
      dbName: process.env.MONGODB_DB_NAME ?? 'amplify-wallet',
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      // Authentication options (if needed)
      ...(process.env.MONGODB_USER && process.env.MONGODB_PASSWORD
        ? {
            auth: {
              username: process.env.MONGODB_USER,
              password: process.env.MONGODB_PASSWORD,
            },
          }
        : {}),
    },
  }),
);
