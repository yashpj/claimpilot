// k6 load test to make the API's HPA scale (spec: demonstrate HPA).
//   k6 run infra/k6/hpa-load.js
//   watch -n2 kubectl -n claimpilot get hpa,pods     (in another terminal)
// /api/health/ready does a real DB round trip through Nest's full request
// pipeline (guards, interceptors, metrics) - enough CPU per request to push
// two 500m pods past the 70% target without needing auth tokens.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://claimpilot.localhost:8081/api";

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      stages: [
        { duration: "1m", target: 50 },   // warm up
        { duration: "3m", target: 200 },  // HPA should add pods here
        { duration: "2m", target: 200 },  // hold: watch new pods go Ready
        { duration: "1m", target: 0 },    // scale-down waits 120s (stabilization window)
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],       // scaling must not cause errors
    http_req_duration: ["p(95)<500"],
  },
};

export default function () {
  const res = http.get(`${BASE}/health/ready`);
  check(res, { "200": (r) => r.status === 200 });
  sleep(0.05);
}
