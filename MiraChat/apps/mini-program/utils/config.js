const app = getApp()

function getApiBase() {
  return app?.globalData?.apiBase || 'http://127.0.0.1:4000'
}

function getDefaultUserId() {
  return app?.globalData?.defaultUserId || 'demo-user'
}

const CHANNEL_PRESET_KEY = 'mirachatMiniChannelPreset'

module.exports = {
  getApiBase,
  getDefaultUserId,
  storageKeys: {
    session: 'mirachat-mini-session',
    bootstrap: 'mirachat-mini-bootstrap',
    channelPreset: CHANNEL_PRESET_KEY,
  },
  channelPresets: [
    { label: 'WeChat', channel: 'wechat', accountId: 'wechat-account' },
    { label: 'WhatsApp (Twilio)', channel: 'twilio_whatsapp', accountId: 'default-account' },
    { label: 'Telegram', channel: 'telegram', accountId: 'telegram-account' },
    { label: 'WeCom', channel: 'wecom', accountId: 'wecom-app' },
  ],
  getChannelPreset() {
    try {
      const { channelPresets } = this
      const saved = wx.getStorageSync(CHANNEL_PRESET_KEY)
      if (saved && saved.channel && saved.accountId) {
        const idx = channelPresets.findIndex(
          p => p.channel === saved.channel && p.accountId === saved.accountId,
        )
        const p = channelPresets[idx >= 0 ? idx : 0]
        return { presetIndex: idx >= 0 ? idx : 0, label: p.label, channel: p.channel, accountId: p.accountId }
      }
    } catch (_) {}
    const p = this.channelPresets[0]
    return { presetIndex: 0, label: p.label, channel: p.channel, accountId: p.accountId }
  },
  setChannelPreset(preset) {
    wx.setStorageSync(CHANNEL_PRESET_KEY, { channel: preset.channel, accountId: preset.accountId })
  },
}
