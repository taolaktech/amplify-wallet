import { Injectable, Logger } from '@nestjs/common';
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
} from 'axios';
import { ServiceRegistryService } from '../services/service-registry.service';
import { ServiceName } from '../types/service.types';

export interface InternalRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

@Injectable()
export class InternalHttpHelper {
  private readonly logger = new Logger(InternalHttpHelper.name);
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private serviceName: string;

  constructor(private serviceRegistry: ServiceRegistryService) {
    this.axiosInstance = axios.create({
      timeout: 10000,
    });
  }

  forService(serviceName: ServiceName): InternalHttpHelper {
    this.serviceName = serviceName;
    this.baseUrl = this.serviceRegistry.getServiceBaseUrl(serviceName);

    this.logger.log(
      `Configured internal HTTP helper for service: ${serviceName} with base URL: ${this.baseUrl}`,
    );

    return this;
  }

  async send<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    options: InternalRequestOptions = {},
  ): Promise<T> {
    if (!this.baseUrl) {
      const error =
        'Base URL not set. Call forService() before making requests.';
      this.logger.error(error);
      throw new Error(error);
    }

    const fullUrl = `${this.baseUrl}/${url.replace(/^\//, '')}`;

    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const config: AxiosRequestConfig = {
      method,
      url: fullUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Internal ${process.env.INTERNAL_REQUEST_TOKEN}`,
        'X-Request-ID': requestId,
        ...options.headers,
      },
      timeout: options.timeout || 10000,
    };

    if (['POST', 'PUT', 'PATCH'].includes(method) && data) {
      config.data = data;
    }

    this.logger.debug(
      `[${requestId}] Making ${method} request to ${this.serviceName} service: ${fullUrl}`,
    );

    try {
      const response: AxiosResponse<T> =
        await this.axiosInstance.request(config);
      this.logger.debug(
        `[${requestId}] Successful ${method} response from ${this.serviceName} service: ${fullUrl}`,
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const errorMessage = `Internal service call failed:
          Service: ${this.serviceName}
          Endpoint: ${fullUrl}
          Method: ${method}
          Status: ${axiosError.response?.status}
          Request ID: ${requestId}
          Error: ${axiosError.message}
          Response: ${JSON.stringify(axiosError.response?.data)}`;

        // this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }

      const genericError = `Unexpected error calling ${this.serviceName} service at ${fullUrl}: ${error.message}`;
      this.logger.error(genericError);
      throw new Error(genericError);
    }
  }

  async get<T = any>(
    url: string,
    options?: InternalRequestOptions,
  ): Promise<T> {
    return this.send<T>('GET', url, undefined, options);
  }

  async post<T = any>(
    url: string,
    data?: any,
    options?: InternalRequestOptions,
  ): Promise<T> {
    return this.send<T>('POST', url, data, options);
  }

  async put<T = any>(
    url: string,
    data?: any,
    options?: InternalRequestOptions,
  ): Promise<T> {
    return this.send<T>('PUT', url, data, options);
  }

  async delete<T = any>(
    url: string,
    options?: InternalRequestOptions,
  ): Promise<T> {
    return this.send<T>('DELETE', url, undefined, options);
  }

  async patch<T = any>(
    url: string,
    data?: any,
    options?: InternalRequestOptions,
  ): Promise<T> {
    return this.send<T>('PATCH', url, data, options);
  }
}
