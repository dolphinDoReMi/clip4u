const { getApiBase, getDefaultUserId, storageKeys } = require('./config')
const { getSessionToken, setSession } = require('./session')

function request({ path, method = 'GET', data, auth = false }) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' }
    if (auth) {
      const token = getSessionToken()
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
    }

    wx.request({
      url: `${getApiBase()}${path}`,
      method,
      data,
      header: headers,
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
          return
        }
        reject(new Error((res.data && res.data.error) || `Request failed (${res.statusCode})`))
      },
      fail: reject,
    })
  })
}

async function login() {
  const loginResult = await new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject,
    })
  })
  const code = loginResult.code
  if (!code) {
    throw new Error('wx.login did not return a code')
  }

  const session = await request({
    path: '/mini-program/login',
    method: 'POST',
    data: {
      code,
      userId: getDefaultUserId(),
    },
  })
  setSession(session)
  return session
}

async function getBootstrap({ channel = 'wecom', accountId = 'wecom-app' } = {}) {
  const payload = await request({
    path: `/mini-program/bootstrap?channel=${encodeURIComponent(channel)}&accountId=${encodeURIComponent(accountId)}`,
    method: 'GET',
    auth: true,
  })
  wx.setStorageSync(storageKeys.bootstrap, payload)
  return payload
}

function getCachedBootstrap() {
  return wx.getStorageSync(storageKeys.bootstrap) || null
}

function assist({ text, threadId }) {
  return request({
    path: '/mini-program/assist',
    method: 'POST',
    auth: true,
    data: {
      text,
      threadId,
    },
  })
}

function approveDraft(id) {
  return request({ path: `/mini-program/drafts/${id}/approve`, method: 'POST', auth: true, data: {} })
}

function rejectDraft(id) {
  return request({ path: `/mini-program/drafts/${id}/reject`, method: 'POST', auth: true, data: {} })
}

function editDraft(id, editedText) {
  return request({
    path: `/mini-program/drafts/${id}/edit`,
    method: 'POST',
    auth: true,
    data: { editedText },
  })
}

function selectDraftOption(id, index) {
  return request({
    path: `/mini-program/drafts/${id}/select-option`,
    method: 'POST',
    auth: true,
    data: { index },
  })
}

module.exports = {
  login,
  getBootstrap,
  getCachedBootstrap,
  assist,
  approveDraft,
  rejectDraft,
  editDraft,
  selectDraftOption,
}
