import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Observable, tap } from "rxjs";
import { MetricsService } from "./metrics.service";

// Interceptors wrap the handler (before AND after), which is exactly what
// request logging and latency metrics need. Guards can't see the response;
// middleware can't see which route matched.
@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  constructor(private readonly metrics: MetricsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id: string } }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const started = process.hrtime.bigint();
    // Propagate an incoming request id (from the ingress) or mint one, and
    // echo it back so a customer's bug report can be matched to a log line.
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    res.setHeader("x-request-id", requestId);
    const route =
      (req.route as { path?: string } | undefined)?.path ?? "unmatched";

    const done = (status: number) => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.httpDuration.observe(
        { method: req.method, route, status: String(status) },
        seconds,
      );
      if (route === "/metrics" || route.startsWith("/health")) return; // probe noise
      this.logger.log({
        requestId,
        method: req.method,
        route,
        status,
        ms: Math.round(seconds * 1000),
        user: req.user?.id,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => done(res.statusCode),
        error: (err: unknown) =>
          done(err instanceof HttpException ? err.getStatus() : 500),
      }),
    );
  }
}
