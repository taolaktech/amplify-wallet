import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { validationConfig } from './config/validation.config';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import { apiReference } from '@scalar/nestjs-api-reference';

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
  // app.use(helmet());
  // Apply helmet to all routes except /docs
  app.use((req, res, next) => {
    if (req.path.startsWith('/docs')) {
      // Skip helmet for docs route
      return next();
    }

    // Apply helmet for all other routes
    helmet()(req, res, next);
  });

  // Swagger Setup
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Amplify Wallet')
    .setDescription('Amplify Wallet API for handling payments')
    .setVersion('1.0')
    .addTag('customers', 'Stripe Customers endpoint')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // SwaggerModule.setup('api', app, document);
  const dir = './public';

  // Ensure the directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write the Swagger JSON to the public directory
  writeFileSync('./public/swagger.json', JSON.stringify(document));
  // SwaggerModule.setup('docs', app, documentFactory, redocOptions);
  app.use(
    '/docs',
    apiReference({
      content: document,
      theme: 'saturn',
      layout: 'modern',
      defaultHttpClient: {
        targetKey: 'javascript',
        clientKey: 'fetch',
      },
      showSidebar: true,
      customCss:
        '--scalar-color-1: #121212; --scalar-color-2: #2a2a2a; --scalar-color-3: #8b5cf6;',
      searchHotKey: 'k',
      navigation: {
        title: 'Amplify Integrations API',
      },
    }),
  );

  // app.use('/api-json', (req, res) => {
  //   res.header('Content-Type', 'application/json');
  //   res.send(JSON.stringify(document, null, 2));
  // });

  // Apply global validation pipe
  app.useGlobalPipes(validationConfig);

  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port).then(() => {
    console.log(`Application is running on 🌐: ${port}`);
    console.log(`Swagger UI 📋: http://localhost:${port}/docs`);
  });
}
bootstrap();
