// Plain-language explanations shown on hover wherever these numbers appear.
export const glossary = {
  requests: 'How many requests were sent and got an answer (or failed).',
  sent: 'How many requests were sent.',
  ok: 'Requests that got an answer with status 200 to 399, without a timeout or connection problem.',
  failed:
    'Requests that did not succeed: a timeout, a connection or TLS problem, an HTTP 4xx or 5xx answer, or a request that could not be built from its template.',
  failedPct: 'The share of all requests that failed.',
  rps: 'Requests completed per second. Higher is better, as long as responses stay fast and correct.',
  avg: 'Average time from sending a request until its whole answer arrived.',
  p50: 'Half of the requests were answered faster than this (the median).',
  p90: '90% of the requests were answered faster than this.',
  p95: '95% of the requests were answered faster than this. Only 1 in 20 was slower. A good measure of what most users experience.',
  p99: '99% of the requests were answered faster than this. Only 1 in 100 was slower. Shows the worst cases, outliers excluded.',
  max: 'The slowest single request.',
  users:
    'Simulated users (also called virtual users, VUs): each one sends the requests one after another, as fast as the server answers. More users means more requests at the same time.',
  duration: 'How long the run lasted.',
  status: 'The HTTP status code the server answered with. 2xx and 3xx count as success, 4xx and 5xx as failures.',
  result:
    'Passed: the run finished and every pass/fail rule held. Failed: the run finished but broke a pass/fail rule. Finished: the run finished but the test has no pass/fail rules, so check the failed requests too. Stopped: someone or something ended it early.',
  interval: 'Each row sums up this many seconds of the run.',
  total: 'All requests together. Response times here are computed over every request, not averaged per row.',
  folder: 'An optional group for tests in a project, such as "Orders" or "Orders / Admin". Tests without a folder are listed on their own.',
} as const
