import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { validationConfig } from './config/validation.config';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    bodyParser.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.enableCors();
  // add helmet middleware
  app.use(helmet());

  // Swagger Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Amplify Wallet')
    .setDescription('Amplify Wallet API for handling payments')
    .setVersion('1.0')
    .addTag('customers', 'Stripe Customers endpoint')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  // Apply global validation pipe
  app.useGlobalPipes(validationConfig);

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port).then(() => {
    console.log(`Application is running on 🌐: ${port}`);
    console.log(`Swagger UI 📋: http://localhost:${port}/api`);
  });
}
bootstrap();
