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

At the July 11, 2026 receipt time, successful responses contained `script-src 'self' 'unsafe-inline'`, while conditional requests with the returned ETag received `304 Not Modified` with `script-src 'self'`. Before the Phase 1 implementation, the static-export override in `src/feed/server.ts` depended on a `text/html` response content type; a 304 had no content type, so the stricter global policy remained.

## Monitoring disposition

`web-next` has no client exception reporter or global `error`/`unhandledrejection` signal. The failure therefore has no product telemetry receipt today. Server availability checks can remain green because the HTML request succeeds.

## Durable gate

Run from the repository root:

```bash
npm --prefix web-next run smoke:production
```

The Playwright smoke checks all four routes in 1440 by 1000 desktop Chrome and a 390 by 900 mobile Chrome profile. For each route it verifies the initial render, ordinary revalidation, cache-bypassing refresh, browser errors, response size, and 200/304 CSP and cache-policy parity.

Before Phase 1 deployment, the smoke was expected to fail against the July 11, 2026 production release. That failure was the Phase 0 release gate, not a flaky-test exception.

## Phase 1 response-header fix verification

The first Phase 1 reliability slice makes the static-export response-header policy explicit in `src/feed/static-export-headers.ts`. A conditional HTML response is identified from its `304` status and browser HTML `Accept` header, so it receives the same CSP and `no-cache` policy as the original `200` response even though a 304 has no content type.

Verification before deployment:

- Focused Fastify response-cycle regression: passed.
- Root TypeScript build: passed.
- `web-next` lint and production build: passed.
- Credential-free local Fastify server plus the complete desktop/mobile Playwright matrix: 2/2 projects passed.
- Before Phase 1 deployment, the live production matrix remained red on all four routes and both viewports, as expected.

At receipt time, the local pass and live failure demonstrated that the guard detected the deployed defect and accepted the proposed response-header correction. Production reliability remained gated until the fix could be reviewed, merged, deployed, and verified by a green live matrix.

## Remaining physical-device probe

The current Mac reports no available iOS Simulator runtime, and Android Debug Bridge is not installed. Run three ordinary loads and three cache-bypassing refreshes on one physical mobile browser after the policy fix, then attach screenshots and browser/version details to PROJ-1753.
