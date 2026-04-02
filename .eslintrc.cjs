const rules = {
  'no-use-before-define': 'off',
}

module.exports = {
  extends: '@chatie',
  rules,
  parserOptions: {
    project: ['./tsconfig.lint.json'],
    tsconfigRootDir: __dirname,
  },
}
