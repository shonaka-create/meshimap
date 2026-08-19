/**
 * 禁止語フィルタのテスト。
 *
 * ★ 大事なのは「弾く」より「通す」のほう。
 *   飲食店のレビューは褒め言葉が汚い。「バカうまい」「死ぬほど美味い」
 *   「デブ活」を弾いてしまうとアプリが使えなくなる。
 *   ここに並んでいる「通す」は、実際に書かれうる文として選んである。
 *   語を足すときは、まずこのテストを走らせること。
 *
 * テスト用のライブラリは入れていない。Node 24 は .ts を
 * そのまま読めるので、本物の実装をそのまま呼んでいる。
 *
 * 実行: npm run test:moderation   （リポジトリ直下で）
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const modulePath = join(root, 'mobile', 'src', 'lib', 'moderation.ts')

const { containsProhibitedContent, anyProhibitedContent, isProhibitedContentError } =
  await import(`file://${modulePath.replace(/\\/g, '/')}`)

/** 通ってほしい入力。1つでも弾かれたらテストは失敗。 */
const MUST_PASS = [
  // 普通の店名
  '麺屋 こうじ',
  'すし処 大将',
  'Trattoria da Luca',
  'CAFE & BAR sunset',

  // 飲食レビューでよくある、汚いが肯定的な言い回し
  'ここのラーメンは死ぬほど美味い',
  'バカうまい',
  '馬鹿でかいパフェ',
  'クソうまいラーメン',
  'アホみたいな量が出てくる',
  'デブ活の締めにおすすめ',
  'ヤバい。語彙力が消える',
  '悩殺されるほど濃厚なソース',

  // 禁止語を部分文字列として含む、無害な食べ物・言葉
  'デブ活の締めにシャブシャブ',   // シャブ
  'しゃぶしゃぶ食べ放題',
  '支那そばが名物です',            // 支那
  '麻薬卵をのせた丼',              // 麻薬
  'グレイプフルーツサワー',        // レイプ
  'sea bass のカルパッチョ',       // ass
  'クミンが効いている cumin ライス', // cum
  'grape juice が自家製',          // rape
  'unisex なので入りやすい',       // sex
  'shellfish のアレルギー対応あり', // hell
  'cocktail が豊富',               // cock
  '大麻駅前の喫茶店',              // 大麻
  'ちんちんに熱いおでん',          // ちんちん（名古屋方言）
  'フェラーリが停まっていた',      // フェラ
  '処女作の味を守っている',        // 処女
  '相殺するくらい甘い',            // 殺す
  '4年ぶりに来た',                 // 4ね
  '美味いしね、また来る',          // しね
  'シネマの帰りに寄った',          // シネ

  // 空・未入力
  '',
  '   ',
  null,
  undefined,
]

/** 弾いてほしい入力。1つでも通ったらテストは失敗。 */
const MUST_BLOCK = [
  // 脅迫・侮辱
  '死ね',
  'お前なんか氏ね',
  '殺すぞ',
  'ぶっ殺してやる',
  'くたばれこの店',
  'クソ野郎の店員',

  // 差別・ヘイト
  'この店の店員はキチガイ',
  'きちがいみたいな対応',
  'ガイジ向けの店',

  // 性的
  'セックスの話ばかりする店',
  'オナニーみたいなラーメン',
  'ポルノみたいな内装',

  // 違法行為
  '覚醒剤を売っています',
  'コカインが手に入る',

  // 英語
  'fuck this place',
  'the staff is a bitch',
  'total bullshit',
  'kill yourself',

  // 全角・半角カナでの回避
  'ｆｕｃｋ this place',
  'ＦＵＣＫ',
  'ﾎﾟﾙﾉみたいな内装',

  // 大文字小文字の混在
  'FuCk',
  'Kill Yourself',
]

let failures = 0

function check(label, input, expected) {
  const actual = containsProhibitedContent(input)
  if (actual === expected) return
  failures += 1
  console.error(
    `  NG  ${label}: ${JSON.stringify(input)}`
      + `（期待 ${expected ? '弾く' : '通す'} / 実際 ${actual ? '弾いた' : '通した'}）`
  )
}

console.log('通すべき入力を確認します…')
for (const s of MUST_PASS) check('通すはずが弾かれた', s, false)

console.log('弾くべき入力を確認します…')
for (const s of MUST_BLOCK) check('弾くはずが通った', s, true)

// ── まとめて渡す形 ──
console.log('anyProhibitedContent を確認します…')
if (anyProhibitedContent('麺屋 こうじ', 'とても美味しかった') !== false) {
  failures += 1
  console.error('  NG  anyProhibitedContent: 無害な組み合わせを弾きました')
}
if (anyProhibitedContent('麺屋 こうじ', '店員が死ね') !== true) {
  failures += 1
  console.error('  NG  anyProhibitedContent: 片方に禁止語があるのに通しました')
}
if (anyProhibitedContent(null, undefined, '') !== false) {
  failures += 1
  console.error('  NG  anyProhibitedContent: 空だけの組み合わせを弾きました')
}

// ── DB のトリガーが投げたエラーの判別 ──
console.log('isProhibitedContentError を確認します…')
if (isProhibitedContentError({ message: 'prohibited_content' }) !== true) {
  failures += 1
  console.error('  NG  isProhibitedContentError: トリガーのエラーを判別できませんでした')
}
if (isProhibitedContentError({ message: 'follow_limit_reached' }) !== false) {
  failures += 1
  console.error('  NG  isProhibitedContentError: 別のエラーを誤って判別しました')
}
if (isProhibitedContentError(undefined) !== false) {
  failures += 1
  console.error('  NG  isProhibitedContentError: undefined で落ちました')
}

const total = MUST_PASS.length + MUST_BLOCK.length + 6

if (failures > 0) {
  console.error(`\n${failures} 件失敗しました（全 ${total} 件）`)
  console.error('語を足したことで普通のレビューを弾いていないか、')
  console.error('mobile/src/lib/moderation.ts の一覧を見直してください。')
  process.exit(1)
}

console.log(`\nOK: ${total} 件すべて期待どおりです`)
console.log(`   通す ${MUST_PASS.length} 件 / 弾く ${MUST_BLOCK.length} 件 / その他 6 件`)
