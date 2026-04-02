import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEnv = resolve(mirachatRoot, '.env')
if (existsSync(rootEnv)) {
  config({ path: rootEnv })
}
