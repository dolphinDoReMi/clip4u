import { existsSync } from 'node:fs'
import { mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const dist = new URL('./dist/', import.meta.url)
await mkdir(dist, { recursive: true })
const src = new URL('./src/index.html', import.meta.url)
await copyFile(src, new URL('./dist/index.html', import.meta.url))
const measurementSrc = new URL('./src/measurement.html', import.meta.url)
if (existsSync(measurementSrc)) {
  await mkdir(new URL('./dist/measurement/', import.meta.url), { recursive: true })
  await copyFile(measurementSrc, new URL('./dist/measurement/index.html', import.meta.url))
  await copyFile(measurementSrc, new URL('./dist/measurement.html', import.meta.url))
}
console.log(`MiraChat ops console built to ${join(new URL('.', dist).pathname, 'index.html')}`)
