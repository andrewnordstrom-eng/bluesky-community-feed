// Adapter seam for the shadow demo client.
//
import { createHttpShadowDemoClient } from "./http-shadow-demo-client"
import type { ShadowDemoClient } from "./shadow-demo-contract"

let client: ShadowDemoClient | null = null

export function getDemoClient(): ShadowDemoClient {
  if (client === null) {
    client = createHttpShadowDemoClient()
  }
  return client
}
