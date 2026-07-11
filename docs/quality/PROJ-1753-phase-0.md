# PROJ-1753 Phase 0 evidence receipt

Date: 2026-07-11  
Decision owner: Andrew Nordstrom  
Disposition: **CONFIRMED PRODUCT DEFECT**  
Approval source: PROJ-1753 discussion comment `a60e3fbd-a831-47b2-af4a-ce7ee20eca0c`

## Decision

The intermittent blank public page is not limited to an automation harness. Ordinary Chrome and Safari both reproduce it when a cached HTML document is revalidated. Static HTML delivery succeeds, but the conditional response applies a Content Security Policy that blocks the inline bootstrap scripts required by the Next.js static export.

The public front door must not be described as reliable until the conditional-response policy is corrected and the production smoke added by this phase passes.

## Browser matrix

| Browser | Ordinary new-tab loads | Cache-bypassing refreshes | Result |
|---|---:|---:|---|
| Chrome, normal operator profile with extensions | 1/3 rendered | 3/3 rendered | Confirmed |
| Safari, normal operator profile | 1/3 rendered | 3/3 rendered | Confirmed |
| Physical mobile browser | Not run | Not run | Pending device/runtime |

The two failed ordinary loads in each desktop browser displayed only the warm page background. Chrome DevTools recorded blocked inline scripts and uncaught `Connection closed` errors. Safari reproduced the same visible failure without the Chrome extension set, so extension traffic is not the root cause.

## HTTP evidence

| Route | 200 Content-Length | 200 policy | 304 policy |
|---|---:|---|---|
| `/` | 234,110 bytes | inline bootstrap allowed; `no-cache` | inline bootstrap blocked; `public, max-age=0` |
| `/demo/` | 35,768 bytes | inline bootstrap allowed; `no-cache` | inline bootstrap blocked; `public, max-age=0` |
| `/how-it-works/` | 138,140 bytes | inline bootstrap allowed; `no-cache` | inline bootstrap blocked; `public, max-age=0` |
| `/start/` | 49,961 bytes | inline bootstrap allowed; `no-cache` | inline bootstrap blocked; `public, max-age=0` |

The successful responses contain `script-src 'self' 'unsafe-inline'`. Conditional requests with the returned ETag receive `304 Not Modified` with `script-src 'self'`. In `src/feed/server.ts`, the static-export override currently depends on a `text/html` response content type; a 304 has no content type, so the stricter global policy remains.

## Monitoring disposition

`web-next` has no client exception reporter or global `error`/`unhandledrejection` signal. The failure therefore has no product telemetry receipt today. Server availability checks can remain green because the HTML request succeeds.

## Durable gate

Run from `web-next`:

```bash
npm run smoke:production
```

The Playwright smoke checks all four routes in 1440 by 1000 desktop Chrome and a 390 by 900 mobile Chrome profile. For each route it verifies the initial render, ordinary revalidation, cache-bypassing refresh, browser errors, response size, and 200/304 CSP and cache-policy parity.

The smoke is expected to fail against the current production release. That failure is the Phase 0 release gate, not a flaky-test exception.

## Phase 1 response-header fix verification

The first Phase 1 reliability slice makes the static-export response-header policy explicit in `src/feed/static-export-headers.ts`. A conditional HTML response is identified from its `304` status and browser HTML `Accept` header, so it receives the same CSP and `no-cache` policy as the original `200` response even though a 304 has no content type.

Verification before deployment:

- Focused Fastify response-cycle regression: passed.
- Root TypeScript build: passed.
- `web-next` lint and production build: passed.
- Credential-free local Fastify server plus the complete desktop/mobile Playwright matrix: 2/2 projects passed.
- Live production matrix: remains red on all four routes and both viewports, as expected before deployment.

The local pass and live failure demonstrate that the guard detects the deployed defect and accepts the proposed response-header correction. Production reliability remains gated until the fix is reviewed, merged, deployed, and the live matrix turns green.

## Remaining physical-device probe

The current Mac reports no available iOS Simulator runtime, and Android Debug Bridge is not installed. Run three ordinary loads and three cache-bypassing refreshes on one physical mobile browser after the policy fix, then attach screenshots and browser/version details to PROJ-1753.
