import { Injectable } from '@nestjs/common';
import { ServiceName } from '../types/service.types';

// Define available services as a union type for type safety
// export type ServiceName = 'amplify-manager' | 'amplify-wallet';

export interface ServiceConfig {
  host: string;
  port?: number; // Optional since it might be included in the host URL
}

@Injectable()
export class ServiceRegistryService {
  private registry: Record<ServiceName, ServiceConfig>;
  private readonly stage: string;

  constructor() {
    this.stage = process.env.STAGE || 'development';

    // Initialize the registry with service configurations
    this.registry = {
      'amplify-manager': this.parseServiceConfig('AMPLIFY_MANAGER'),
      'amplify-wallet': this.parseServiceConfig('AMPLIFY_WALLET'),
    };
  }

  /**
   * Get the configuration for a specific service
   * @param serviceName The name of the service
   * @returns The service configuration
   */
  getServiceConfig(serviceName: ServiceName): ServiceConfig {
    const config = this.registry[serviceName];
    if (!config) {
      throw new Error(`Service configuration not found for: ${serviceName}`);
    }
    return config;
  }

  /**
   * Get the base URL for a specific service
   * @param serviceName The name of the service
   * @returns The base URL for the service
   */
  getServiceBaseUrl(serviceName: ServiceName): string {
    const config = this.getServiceConfig(serviceName);

    // For local development, append port if provided
    if (this.stage === 'development' && config.port) {
      return `http://${config.host}:${config.port}`;
    }

    // For cloud environments, use the host as is (ALB DNS or domain)
    return this.parseUrl(config.host);
  }

  /**
   * Parse service configuration from environment variables
   * @param serviceEnvPrefix The prefix for the service's environment variables
   * @param stage The current deployment stage
   * @returns The parsed service configuration
   */
  private parseServiceConfig(serviceEnvPrefix: string): ServiceConfig {
    // For different environments, use the appropriate host
    // e.g., AMPLIFY_MANAGER_HOST for local, AMPLIFY_MANAGER_STAGING_HOST for staging
    const host = process.env[`${serviceEnvPrefix}_HOST`];
    if (!host) {
      throw new Error(`Host not configured for service: ${serviceEnvPrefix}`);
    }

    // Only parse port for local development
    const port =
      this.stage === 'development'
        ? parseInt(process.env[`${serviceEnvPrefix}_PORT`] || '0', 10) ||
          undefined
        : undefined;

    return { host, port };
  }

  private parseUrl(baseUrl: string) {
    const urlObject = new URL(baseUrl);
    urlObject.port = '';
    const urlWithoutPort = urlObject.toString();
    return urlWithoutPort.replace(/\/$/, ''); // Remove trailing slash if present
  }
}
