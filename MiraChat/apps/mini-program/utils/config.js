const app = getApp()

function getApiBase() {
  return app?.globalData?.apiBase || 'http://127.0.0.1:4000'
}

function getDefaultUserId() {
  return app?.globalData?.defaultUserId || 'demo-user'
}

module.exports = {
  getApiBase,
  getDefaultUserId,
  storageKeys: {
    session: 'mirachat-mini-session',
    bootstrap: 'mirachat-mini-bootstrap',
  },
}
