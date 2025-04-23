import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthService } from '../../modules/auth/auth.service';
import { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      this.logger.warn('Missing Authorization header');
      // throw new UnauthorizedException('Missing authorization header');
      return false;
    }

    // Extract the token from the Authorization header
    // Expected format: "Bearer <token>"
    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      this.logger.warn(`Invalid Authorization header format: ${authHeader}`);
      // throw new UnauthorizedException('Invalid authorization header format');
      return false;
    }

    try {
      // Verify the token with the auth service
      const authResponse = await this.authService.verifyToken(token);
      this.logger.debug(
        `Response from auth service: ${JSON.stringify(authResponse)}`,
      );

      // Attach the user data to the request for use in controllers
      request['authenticatedData'] = authResponse.data;

      return true;
    } catch (error) {
      this.logger.error(`Authentication failed: ${error.message}`, error.stack);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  private extractTokenFromHeader(request: Request): string | null {
    const headers: any = request.headers;
    const [type, token] = headers.authorization.split(' ');
    return type === 'Bearer' ? token : null;
  }
}
