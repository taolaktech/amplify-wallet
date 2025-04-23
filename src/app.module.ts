import { Module } from '@nestjs/common';
import { Modules } from './modules/modules';
import { ConfigModule, ConfigService } from '@nestjs/config';
import stripeConfig from './config/stripe.config';
import databaseConfig from './config/database.config';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    Modules,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [stripeConfig, databaseConfig],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
        ...configService.get('database.options'),
      }),
    }),
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class AppModule {}
