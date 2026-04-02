const api = require('../../utils/api')
const channelConfig = require('../../utils/config')

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    draft: null,
    editedText: '',
  },

  onLoad(query) {
    this.setData({ id: query.id || '' })
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    try {
      const { channel, accountId } = channelConfig.getChannelPreset()
      const bootstrap = await api.getBootstrap({ channel, accountId })
      const draft = (bootstrap.drafts || []).find(item => item.id === this.data.id) || null
      this.setData({
        loading: false,
        draft,
        editedText: draft ? draft.generatedText : '',
      })
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || String(error),
      })
    }
  },

  onEditInput(event) {
    this.setData({ editedText: event.detail.value })
  },

  async perform(action, payload = {}) {
    try {
      if (action === 'approve') {
        await api.approveDraft(this.data.id)
      } else if (action === 'reject') {
        await api.rejectDraft(this.data.id)
      } else if (action === 'edit') {
        await api.editDraft(this.data.id, this.data.editedText)
      } else if (action === 'select') {
        await api.selectDraftOption(this.data.id, payload.index)
      }
      wx.showToast({ title: 'Updated', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({ delta: 1 })
      }, 400)
    } catch (error) {
      this.setData({ error: error.message || String(error) })
    }
  },

  approve() {
    this.perform('approve')
  },

  reject() {
    this.perform('reject')
  },

  saveEdit() {
    this.perform('edit')
  },

  chooseOption(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.perform('select', { index })
  },
})
