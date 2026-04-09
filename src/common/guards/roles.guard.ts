import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Header-based role guard for internal microservice use.
 *
 * In production this would validate a JWT issued by an identity provider.
 * Here, the upstream API gateway is expected to strip any caller-supplied
 * identity headers and inject its own verified X-User-Id / X-User-Role
 * headers before forwarding the request.
 *
 * Required headers when guard is active:
 *   X-User-Id:   the acting user's identifier
 *   X-User-Role: MANAGER | EMPLOYEE
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-user-id'];
    const userRole = request.headers['x-user-role'];

    if (!userId || !userRole) {
      throw new UnauthorizedException('X-User-Id and X-User-Role headers are required');
    }

    if (!requiredRoles.includes(userRole.toUpperCase())) {
      throw new ForbiddenException(`Role ${userRole} is not authorized for this action`);
    }

    // Expose identity to downstream controller/service via request object
    request.actingUserId = userId;
    request.actingUserRole = userRole.toUpperCase();
    return true;
  }
}
