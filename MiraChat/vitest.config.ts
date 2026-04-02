import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))
const rootEnv = path.join(root, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}
const pkg = (name: string) => path.resolve(root, `packages/${name}/src/index.ts`)

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@delegate-ai/adapter-types': pkg('adapter-types'),
      '@delegate-ai/gateway-runtime': pkg('gateway-runtime'),
      '@delegate-ai/policy-engine': pkg('policy-engine'),
      '@delegate-ai/agent-core': pkg('agent-core'),
      '@delegate-ai/memory': pkg('memory'),
      '@delegate-ai/identity': pkg('identity'),
      '@delegate-ai/approval': pkg('approval'),
      '@delegate-ai/assist-core': pkg('assist-core'),
      '@delegate-ai/db': path.resolve(root, 'packages/db/src/index.ts'),
      '@delegate-ai/negotiation-tools': path.resolve(root, 'packages/negotiation-tools/src/index.ts'),
      '@delegate-ai/openclaw-doer': path.resolve(root, 'packages/openclaw-doer/src/index.ts'),
    },
  },
})
