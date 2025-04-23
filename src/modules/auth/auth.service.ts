import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InternalHttpHelper } from '../../common/helpers/internal-http.helper';

export interface AuthResponse {
  message: string;
  success: boolean;
  data: Record<string, any> | null;
  isValid: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private internalHttpHelper: InternalHttpHelper) {}

  /**
   * Verify a user token by making a request to the auth service
   * @param token The token to verify
   * @returns The authentication response containing user data
   */
  async verifyToken(token: string): Promise<AuthResponse> {
    try {
      this.logger.debug('Verifying token with amplify-manager service');

      // Make a request to the auth service to verify the token
      const response = await this.internalHttpHelper
        .forService('amplify-manager')
        .post<AuthResponse>('api/internal/auth/verify-token', { token });

      this.logger.debug(
        `Received response from auth service: ${JSON.stringify(response)}`,
      );

      if (!response.success) {
        throw new UnauthorizedException('Invalid token');
      }

      return response;
    } catch (error) {
      this.logger.error(
        `Token verification failed: ${error.message}`,
        error.stack,
      );
      throw new UnauthorizedException('Token verification failed');
    }
  }

  /**
   * Verify an internal request token
   * @param token The internal token to verify
   * @returns True if the token is valid
   */
  verifyInternalToken(token: string): boolean {
    // Simple verification for internal token
    // In a real-world scenario, you might want to use a more secure approach
    return token === process.env.INTERNAL_REQUEST_TOKEN;
  }
}
