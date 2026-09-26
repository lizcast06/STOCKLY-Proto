import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const failures = new Rate('http_5xx_rate')
export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '30s', target: 150 },
    { duration: '5m', target: 500 },
    { duration: '30s', target: 0 },
  ],
  thresholds: { http_req_duration: ['p(95)<500'], http_5xx_rate: ['rate<0.005'], http_req_failed: ['rate<0.005'] },
}

export default function () {
  const base = __ENV.BASE_URL || 'http://localhost:3001'
  const response = http.get(`${base}/api/health`)
  failures.add(response.status >= 500)
  check(response, { 'health responde HTTP 200': r => r.status === 200, 'latencia menor a 500 ms': r => r.timings.duration < 500 })
  sleep(1)
}
