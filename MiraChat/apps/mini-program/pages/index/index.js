const api = require('../../utils/api')
const { getSession, clearSession } = require('../../utils/session')
const channelConfig = require('../../utils/config')

Page({
  data: {
    loading: true,
    error: '',
    session: null,
    drafts: [],
    threads: [],
    connection: null,
    assistPrompt: '',
    assistResult: null,
    channelPresets: channelConfig.channelPresets,
    presetLabels: channelConfig.channelPresets.map(p => p.label),
    presetIndex: 0,
    channelLabel: '',
  },

  onShow() {
    this.bootstrap()
  },

  onPresetChange(event) {
    const i = Number(event.detail.value)
    const preset = this.data.channelPresets[i]
    if (!preset) return
    channelConfig.setChannelPreset(preset)
    this.setData({ presetIndex: i, channelLabel: preset.label })
    this.bootstrap()
  },

  async bootstrap() {
    this.setData({ loading: true, error: '' })
    try {
      const { presetIndex, channel, accountId, label } = channelConfig.getChannelPreset()
      let session = getSession()
      if (!session || !session.sessionToken) {
        session = await api.login()
      }
      const bootstrap = await api.getBootstrap({ channel, accountId })
      this.setData({
        loading: false,
        session,
        drafts: bootstrap.drafts || [],
        threads: bootstrap.threads || [],
        connection: bootstrap.connection || null,
        presetIndex,
        channelLabel: label,
      })
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || String(error),
      })
    }
  },

  onAssistInput(event) {
    this.setData({ assistPrompt: event.detail.value })
  },

  async submitAssist() {
    if (!this.data.assistPrompt.trim()) {
      return
    }
    try {
      const { channel, accountId } = channelConfig.getChannelPreset()
      const result = await api.assist({
        text: this.data.assistPrompt,
        threadId: `mini-program-${channel}`,
        channel,
        accountId,
      })
      this.setData({ assistResult: result, error: '' })
    } catch (error) {
      this.setData({ error: error.message || String(error) })
    }
  },

  openDraft(event) {
    const id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({ url: `/pages/draft/index?id=${encodeURIComponent(id)}` })
  },

  async resetSession() {
    clearSession()
    this.setData({ session: null, drafts: [], threads: [], connection: null, assistResult: null })
    await this.bootstrap()
  },
})
