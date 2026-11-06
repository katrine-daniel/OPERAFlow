import { ArgumentsHost, Catch, ConsoleLogger, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '@operaflow/shared';
import type { AuthedRequest } from '../common/auth-context';

/** One JSON object per line in production (ingestible by any log platform); readable text in development. */
export class JsonLogger extends ConsoleLogger {
  private readonly json = process.env.NODE_ENV === 'production' || process.env.LOG_FORMAT === 'json';

  protected override printMessages(messages: unknown[], context = '', logLevel: string = 'log') {
    if (!this.json) return super.printMessages(messages, context, logLevel as never);
    for (const m of messages) {
      const entry = {
        time: new Date().toISOString(),
        level: logLevel,
        context,
        ...(typeof m === 'object' && m !== null ? redactSecrets(m as Record<string, unknown>) : { message: String(m) }),
      };
      process[logLevel === 'error' || logLevel === 'fatal' ? 'stderr' : 'stdout'].write(`${JSON.stringify(entry)}\n`);
    }
  }
}

// ── Metrics (Prometheus text format, in-process counters) ──

const httpCounts = new Map<string, number>();
const httpDurations = { sum: 0, count: 0, buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5].map((le) => ({ le, n: 0 })) };

export function metricsText(gauges: Record<string, number>): string {
  const lines = [
    '# HELP operaflow_http_requests_total HTTP requests by method and status class',
    '# TYPE operaflow_http_requests_total counter',
    ...[...httpCounts.entries()].map(([k, v]) => {
      const [method, cls] = k.split(' ');
      return `operaflow_http_requests_total{method="${method}",status="${cls}"} ${v}`;
    }),
    '# HELP operaflow_http_request_duration_seconds HTTP request duration',
    '# TYPE operaflow_http_request_duration_seconds histogram',
    ...httpDurations.buckets.map((b) => `operaflow_http_request_duration_seconds_bucket{le="${b.le}"} ${b.n}`),
    `operaflow_http_request_duration_seconds_bucket{le="+Inf"} ${httpDurations.count}`,
    `operaflow_http_request_duration_seconds_sum ${httpDurations.sum.toFixed(3)}`,
    `operaflow_http_request_duration_seconds_count ${httpDurations.count}`,
    ...Object.entries(gauges).flatMap(([k, v]) => [`# TYPE ${k} gauge`, `${k} ${v}`]),
  ];
  return `${lines.join('\n')}\n`;
}

/** Assigns/propagates X-Request-Id, logs one line per request, and records metrics. Never logs bodies or query strings. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as Request & { requestId: string }).requestId = id;
    res.setHeader('X-Request-Id', id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const key = `${req.method} ${Math.floor(res.statusCode / 100)}xx`;
      httpCounts.set(key, (httpCounts.get(key) ?? 0) + 1);
      httpDurations.sum += seconds;
      httpDurations.count++;
      for (const b of httpDurations.buckets) if (seconds <= b.le) b.n++;
      if (req.path === '/health' || req.path === '/metrics') return;
      this.logger.log({
        message: 'request',
        requestId: id,
        method: req.method,
        path: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
        userId: (req as AuthedRequest).user?.id,
      });
    });
    next();
  }
}

/** Unhandled errors: logged with the request id; clients get a generic message (no stack, no internals). */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) this.logger.error({ message: exception.message, requestId: req.requestId, path: req.path });
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body, requestId: req.requestId } : { ...(body as object), requestId: req.requestId });
      return;
    }
    // Body-parser errors etc. carry a status; keep it.
    const status = (exception as { status?: number; statusCode?: number })?.status ?? (exception as { statusCode?: number })?.statusCode;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ statusCode: status, message: (exception as Error).message, requestId: req.requestId });
      return;
    }
    this.logger.error({ message: (exception as Error)?.message ?? 'Unknown error', stack: (exception as Error)?.stack?.split('\n').slice(0, 8).join('\n'), requestId: req.requestId, path: req.path });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Internal server error', requestId: req.requestId });
  }
}
