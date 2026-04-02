const { storageKeys } = require('./config')

function getSession() {
  return wx.getStorageSync(storageKeys.session) || null
}

function getSessionToken() {
  const session = getSession()
  return session && session.sessionToken ? session.sessionToken : ''
}

function setSession(session) {
  wx.setStorageSync(storageKeys.session, session)
}

function clearSession() {
  wx.removeStorageSync(storageKeys.session)
}

module.exports = {
  getSession,
  getSessionToken,
  setSession,
  clearSession,
}
