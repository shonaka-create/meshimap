/**
 * iOS のネイティブ設定（Info.plist に落ちる内容）を検査する。
 *
 * なぜ要るか:
 *   app.config.ts に書いていない権限が、プラグインの既定値として
 *   勝手に足される。実際、指定を省いていたせいで
 *
 *     NSMicrophoneUsageDescription                 マイク
 *     NSLocationAlwaysUsageDescription             常時位置情報
 *     NSLocationAlwaysAndWhenInUseUsageDescription
 *     NSFaceIDUsageDescription                     Face ID
 *
 *   の4つが、英語の既定文言つきで入っていた。どれも使っていない。
 *   常時位置情報は審査でとくに厳しく見られるうえ、
 *   App Store のプライバシー表示とも食い違う。
 *
 *   プラグインを更新すると同じことが起きるので、機械で見る。
 *
 * 実行: npm run check:ios   （mobile/ で）
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 出してはいけない権限。使っていないものを宣言すると審査で必ず聞かれる。 */
const FORBIDDEN = [
  'NSMicrophoneUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSFaceIDUsageDescription',
  'NSContactsUsageDescription',
  'NSCalendarsUsageDescription',
  'NSMotionUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
]

/** 無いと困るもの。文言が日本語であることも見る。 */
const REQUIRED = [
  'NSLocationWhenInUseUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSCameraUsageDescription',
]

// ★ npx を呼ばずに Expo の CLI を直接 node で動かす。
//   Windows の Node 24 は .cmd を shell 無しで起動できず（EINVAL）、
//   shell を使うとパスの空白でつまずく。このリポジトリの置き場所には
//   空白が含まれているので、実行ファイルを直接指すのが確実。
const json = execFileSync(
  process.execPath,
  [join(root, 'node_modules', 'expo', 'bin', 'cli'), 'config', '--type', 'introspect', '--json'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
)

const config = JSON.parse(json)
const plist = config.ios?.infoPlist ?? {}
const problems = []

for (const key of FORBIDDEN) {
  if (plist[key] !== undefined) {
    problems.push(
      `${key} が入っています（使っていない権限です）。\n`
        + '        app.config.ts の該当プラグインに false を渡して消してください。'
    )
  }
}

for (const key of REQUIRED) {
  const value = plist[key]
  if (value === undefined) {
    problems.push(`${key} がありません。`)
    continue
  }
  // 既定の英語文言のままだと、何に使うのか審査側に伝わらない
  if (/^Allow \$\(PRODUCT_NAME\)/.test(value) || !/[ぁ-んァ-ヶ一-龠]/.test(value)) {
    problems.push(`${key} が既定の英語文言のままです: ${value}`)
  }
}

// 輸出コンプライアンス。未設定だと提出のたびに手で答えることになる
if (plist.ITSAppUsesNonExemptEncryption !== false) {
  problems.push(
    'ITSAppUsesNonExemptEncryption が false になっていません。'
      + '\n        未設定だと提出のたびに輸出コンプライアンスの質問に答える必要があります。'
  )
}

if (!config.ios?.bundleIdentifier) problems.push('ios.bundleIdentifier がありません。')

if (problems.length) {
  console.error('NG  iOS のネイティブ設定に問題があります:\n')
  for (const p of problems) console.error('   -  ' + p)
  process.exit(1)
}

console.log('OK: iOS の権限宣言は、使っているものだけ・日本語で入っています')
console.log(`    bundleId ${config.ios.bundleIdentifier} / version ${config.version}`)
