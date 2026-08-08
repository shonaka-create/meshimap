module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // reanimated v4 のワークレット変換。プラグイン配列の最後に置く決まり。
    plugins: ['react-native-worklets/plugin'],
  }
}
