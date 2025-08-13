import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionSchema, UserSchema, WalletSchema } from './schema';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
        ...configService.get('database.options'),
      }),
    }),
    MongooseModule.forFeature([
      { name: 'users', schema: UserSchema },
      { name: 'transactions', schema: TransactionSchema },
      { name: 'wallets', schema: WalletSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
