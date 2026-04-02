import { mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const dist = new URL('./dist/', import.meta.url)
await mkdir(dist, { recursive: true })
await copyFile(new URL('./src/index.html', import.meta.url), new URL('./dist/index.html', import.meta.url))
console.log(`MiraChat web client built to ${join(new URL('.', dist).pathname, 'index.html')}`)
