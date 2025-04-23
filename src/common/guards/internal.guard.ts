import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthService } from '../../modules/auth/auth.service';

@Injectable()
export class InternalGuard implements CanActivate {
  private readonly logger = new Logger(InternalGuard.name);

  constructor(private authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      this.logger.warn('Missing Authorization header for internal request');
      // throw new UnauthorizedException('Missing authorization header');
      return false;
    }

    // Extract the token from the Authorization header
    // Expected format: "Internal <token>"
    const [type, token] = authHeader.split(' ');

    if (type !== 'Internal' || !token) {
      this.logger.warn(
        `::: Invalid internal Authorization header format: ${authHeader} :::`,
      );
      return false;
    }

    // Verify the internal token
    const isValid = this.authService.verifyInternalToken(token);

    if (!isValid) {
      this.logger.warn('::: Invalid internal token :::');
      return false;
    }

    // Mark the request as internal
    request.isInternalRequest = true;

    return true;
  }

  private extractTokenFromHeader(request: Request): string | null {
    const headers: any = request.headers;
    const [type, token] = headers.authorization.split(' ');
    return type === 'Internal' ? token : null;
  }
}
