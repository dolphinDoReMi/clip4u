/**
 * Infer image MIME from base64 payload using magic bytes (first decoded octets).
 * Used when clients omit or mislabel screenshotMimeType so vision requests still attach the image.
 */
export function inferImageMimeFromBase64(b64: string): string | undefined {
  const cleaned = String(b64 || '').replace(/\s+/g, '')
  if (!cleaned.length) {
    return undefined
  }
  const take = Math.min(cleaned.length, 256)
  let bin: string
  try {
    bin = atob(cleaned.slice(0, take))
  } catch {
    return undefined
  }
  if (bin.length < 12) {
    return undefined
  }
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    u[i] = bin.charCodeAt(i)
  }
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
    return 'image/png'
  }
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) {
    return 'image/jpeg'
  }
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x38) {
    return 'image/gif'
  }
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && bin.length >= 12) {
    const tag = bin.slice(8, 12)
    if (tag === 'WEBP') {
      return 'image/webp'
    }
  }
  return undefined
}

/** MIME types we send to OpenRouter as image_url parts. */
export const isOpenRouterVisionImageMime = (mime: string): boolean =>
  /^image\/(png|jpeg|jpg|jpe|jfif|pjpeg|webp|gif|x-png)$/i.test(String(mime || '').trim())
