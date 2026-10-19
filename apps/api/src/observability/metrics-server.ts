import { createServer, type Server } from "node:http";
import type { MetricsService } from "./metrics.service";

// /metrics on its OWN port (default 9464), not on the public API port.
// The ingress only routes to :3000, so metrics (route names, volumes,
// error rates) are never internet-reachable, and Prometheus scrapes :9464
// inside the cluster. Separate port > auth on /metrics: nothing to leak or
// misconfigure.
export function startMetricsServer(
  metrics: MetricsService,
  port: number,
): Server {
  const server = createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    metrics.registry
      .metrics()
      .then((body) => {
        res
          .writeHead(200, { "Content-Type": metrics.registry.contentType })
          .end(body);
      })
      .catch((err: unknown) => res.writeHead(500).end(String(err)));
  });
  server.listen(port, "0.0.0.0");
  return server;
}
