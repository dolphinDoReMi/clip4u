const api = require('../../utils/api')
const { getSession, clearSession } = require('../../utils/session')

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
  },

  onShow() {
    this.bootstrap()
  },

  async bootstrap() {
    this.setData({ loading: true, error: '' })
    try {
      let session = getSession()
      if (!session || !session.sessionToken) {
        session = await api.login()
      }
      const bootstrap = await api.getBootstrap()
      this.setData({
        loading: false,
        session,
        drafts: bootstrap.drafts || [],
        threads: bootstrap.threads || [],
        connection: bootstrap.connection || null,
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
      const result = await api.assist({ text: this.data.assistPrompt, threadId: 'mini-program-thread' })
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
