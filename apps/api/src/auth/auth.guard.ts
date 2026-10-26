import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { ConfigService } from "@nestjs/config";
import type { AuthedRequest } from "./current-user";

@Injectable()
export class AuthGuard implements CanActivate {
  private supabase: ReturnType<typeof createClient>;

  constructor(private config: ConfigService) {
    this.supabase = createClient(
      this.config.getOrThrow("SUPABASE_URL"), // getOrThrow = loud failure if missing
      this.config.getOrThrow("SUPABASE_ANON_KEY"),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const authHeader = request.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or malformed token");
    }

    const token = authHeader.slice(7); // strip "Bearer "

    // Ask Supabase to validate the token and return the user.
    // Tradeoff (DECISIONS.md): a network hop per request vs local JWT verify.
    const { data, error } = await this.supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException("Invalid token");
    }

    // Attach the user so downstream handlers can read it.
    request.user = { id: data.user.id, email: data.user.email };
    return true;
  }
}
