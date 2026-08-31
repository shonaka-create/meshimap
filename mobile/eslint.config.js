// ============================================================
// mobile/ の lint 設定
//
// これが無かったせいで、Expo アプリ側は一度も lint されていなかった。
// ルートの eslint.config.mjs は mobile/** を除外していて、
// mobile 側には設定が無い。両方合わせて「誰も見ていない」状態だった。
//
// その結果、早期リターンより後ろに useCallback を置くという
// 明確な間違い（Rules of Hooks 違反）が素通りし、
// プロフィールを開くと必ず落ちるアプリを配信してしまった。
//
// ★ react-hooks/rules-of-hooks は警告ではなく error にしてある。
//   これは「行儀の問題」ではなく、踏んだら確実に落ちる類の間違い。
//   CI で止めないと意味がない。
// ============================================================

const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', '.expo/**', 'node_modules/**', 'scripts/**'],
  },
  {
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // 依存配列の漏れは、直すと挙動が変わることがあるので警告どまり。
      // 落ちはしないが、古い値を掴んだままになる原因にはなる。
      'react-hooks/exhaustive-deps': 'warn',

      // ── ここから下は React Compiler 向けの新しい規則 ──────
      // 「こう書くと最適化が効かない／将来困る」という助言で、
      // 今のコードが落ちるわけではない。既存コードに40件出るので、
      // これを error のままにすると CI が永久に赤いままになり、
      // 本当に落ちる rules-of-hooks の警告も一緒に埋もれる。
      // 見えるようには残しつつ、止めるのは落ちる方だけにする。
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
])
