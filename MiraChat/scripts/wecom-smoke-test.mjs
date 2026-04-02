import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

const rootEnv = resolve(process.cwd(), '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}

const apiBase = (process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
const gatewayPort = Number(process.env.WECOM_GATEWAY_PORT ?? 4030)
const gatewayBase = `http://127.0.0.1:${gatewayPort}`
const accountId = process.env.WECOM_ACCOUNT_ID ?? 'wecom-app'
const corpId = process.env.WECOM_CORP_ID ?? ''
const corpSecret = process.env.WECOM_CORP_SECRET ?? ''
const token = process.env.WECOM_TOKEN ?? ''
const aesKey = process.env.WECOM_ENCODING_AES_KEY ?? ''
const agentId = process.env.WECOM_AGENT_ID ?? ''

const pretty = value => JSON.stringify(value, null, 2)

const checkJson = async (label, url) => {
  const response = await fetch(url)
  const json = await response.json().catch(() => ({}))
  console.log(`\n## ${label}`)
  console.log('status:', response.status)
  console.log(pretty(json))
  return { response, json }
}

console.log('# WeCom Smoke Test')
console.log('apiBase:', apiBase)
console.log('gatewayBase:', gatewayBase)
console.log('accountId:', accountId)

await checkJson('API health', `${apiBase}/health`)
await checkJson('Gateway health', `${gatewayBase}/health`)
await checkJson(
  'MiraChat connection row',
  `${apiBase}/mirachat/connection?channel=${encodeURIComponent('wecom')}&accountId=${encodeURIComponent(accountId)}`,
)

console.log('\n## Credential readiness')
console.log(
  pretty({
    corpId: Boolean(corpId),
    corpSecret: Boolean(corpSecret),
    token: Boolean(token),
    encodingAesKey: Boolean(aesKey),
    agentId: Boolean(agentId),
  }),
)

if (corpId && corpSecret) {
  const tokenUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
  tokenUrl.searchParams.set('corpid', corpId)
  tokenUrl.searchParams.set('corpsecret', corpSecret)
  const response = await fetch(tokenUrl)
  const json = await response.json().catch(() => ({}))
  console.log('\n## Official gettoken check')
  console.log('status:', response.status)
  console.log(pretty(json))
} else {
  console.log('\n## Official gettoken check')
  console.log('skipped: set WECOM_CORP_ID and WECOM_CORP_SECRET')
}
