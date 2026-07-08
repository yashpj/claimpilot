import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";

@Injectable()
export class AuthGuard implements CanActivate {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers["authorization"];

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or malformed token");
    }

    const token = authHeader.slice(7); // strip "Bearer "

    // Ask Supabase to validate the token and return the user.
    const { data, error } = await this.supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException("Invalid token");
    }

    // Attach the user so downstream handlers can read it.
    request.user = data.user;
    return true;
  }
}