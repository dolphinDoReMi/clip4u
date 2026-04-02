import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)

const required = [
  'app.js',
  'app.json',
  'app.wxss',
  'project.config.json',
  'utils/api.js',
  'utils/config.js',
  'utils/session.js',
  'pages/index/index.js',
  'pages/index/index.wxml',
  'pages/draft/index.js',
  'pages/draft/index.wxml',
]

const missing = required.filter(path => !existsSync(join(root.pathname, path)))
if (missing.length) {
  console.error('Mini Program scaffold missing files:\n' + missing.map(path => `- ${path}`).join('\n'))
  process.exit(1)
}

console.log('Mini Program scaffold verified')
