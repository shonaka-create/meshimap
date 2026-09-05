/**
 * @taro（田中太郎）を、実運用する本アカウント @ebichan（えびちゃん）に作り替える。
 *
 * なぜ別スクリプトなのか:
 *   scripts/seed.mjs は「デモデータを作る」ためのもので、
 *   流すたびに全アカウントを同じ内容へ揃え直す。本アカウントを
 *   その中に置いたままにすると、次に誰かが npm run seed を叩いた瞬間に
 *   表示名も自己紹介も投稿も、デモの内容へ静かに巻き戻る。
 *   だから本アカウントは seed.mjs から外し（同じ変更で外してある）、
 *   この一本だけが触れるようにした。
 *
 * このスクリプトがやること:
 *   1. アカウントにサインインする（既存の @taro のアドレスとパスワード）
 *   2. プロフィールを @ebichan / えびちゃん に書き換える
 *   3. 下の POSTS に無い投稿を消す（＝旧デモ15件が消える）
 *   4. POSTS のうち、まだ入っていないものを投稿する
 *
 *   3と4は「店名（location_name）が一致するか」で見ているので、
 *   何度流しても結果は同じになる（冪等）。
 *
 * ★ is_demo（デモ用アカウントの印）はここでは外せない。
 *   移行0010 のトリガー protect_demo_flag が、
 *   auth.uid() のある経路からの変更を全て差し戻すため。
 *   これは仕様どおりで、本人が自分でデモの印を外せてしまっては
 *   印の意味が無くなる。外すには Supabase の SQL Editor から
 *   supabase/migrations/0018_ebichan_real_account.sql を流すこと。
 *   このスクリプトは最後に、印が残っていれば警告を出す。
 *
 * 実行:
 *   node scripts/seed-ebichan.mjs            … 確認だけ（何も書き込まない）
 *   node scripts/seed-ebichan.mjs --apply    … 実際に書き込む
 *
 * 必要な環境変数（.env.local から読む）:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SEED_PASSWORD          … このアカウントのパスワード
 *   EBICHAN_EMAIL          … 省略時 teardoro+taro@gmail.com
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')

/** .env.local を読む。既に環境変数にあるものは上書きしない。 */
function loadEnvLocal() {
  const file = path.join(ROOT, '.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (value && !process.env[m[1]]) process.env[m[1]] = value
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const PASSWORD = process.env.SEED_PASSWORD

/**
 * ログインに使うアドレス。
 *
 * ★ ここを間違えると「別アカウントが作られる」のではなく、
 *   単にサインインに失敗して止まる（このスクリプトは新規登録をしない）。
 *   本アカウントを取り違えて上書きするより、失敗して止まるほうがいい。
 */
const EMAIL = process.env.EBICHAN_EMAIL || 'teardoro+taro@gmail.com'

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です')
  process.exit(1)
}
if (!PASSWORD) {
  console.error('❌ SEED_PASSWORD が未設定です（.env.local に入っています）')
  process.exit(1)
}

// ============================================================
// プロフィール
// ============================================================
const PROFILE = {
  /** DBの制約は ^[a-z]{3,20}$（英小文字のみ）。数字も記号も入らない */
  username: 'ebichan',
  displayName: 'えびちゃん',
  /** 画面の上限は200文字（settings/edit-profile.tsx） */
  bio: '神楽坂と飯田橋のあたりをうろうろしています。坂の途中や、路地を一本入ったところにある店が好きで、イタリアンとフレンチが多め。値段よりも「また来たくなるか」で選んでいます。',
  /**
   * アイコンは未設定に戻す。
   *
   * ★ pravatar を入れたままにしないこと。
   *   あれは実在しない他人の顔写真を配る外部サービスで、
   *   デモなら成立しても、本人が名乗って使うアカウントの
   *   アイコンとしては筋が通らない。
   *   空にすると Avatar が頭文字（「え」）を描く（ui.tsx）。
   */
  photoUrl: null,
}

// ============================================================
// 投稿
//
// ★ 全て実在の店。2026-09-04 に所在地を確認した。
//   本文は「その店が何で知られているか」と「場所の感じ」だけで書いている。
//   行った日の出来事や、店主と交わした会話のような
//   確かめようのない話は入れていない。
//   実在の店に架空の体験談を付けると、事実と区別がつかなくなる。
//
// ★ 座標は街区の目安。建物単位の精度は無い。
//   エリア判定（最寄り8km）には十分で、下の checkPosts() が
//   regions.ts の判定と食い違っていないかを毎回見る。
// ============================================================
const POSTS = [
  /* ── イタリアン ───────────────────────────── */
  {
    caption:
      '神楽坂のイタリアンといえば、まずここの名前が挙がる。細工町の坂を下りたところに30年以上あって、'
      + '東京のイタリア料理がまだ「かしこまって食べるもの」だった頃からこの場所でやっている。'
      + '神楽坂で一軒だけ挙げろと言われたら、結局ここに戻ってくる',
    rating: 5,
    genre: 'イタリアン',
    price_range: '¥5,001〜¥10,000',
    location_name: 'リストランテ カルミネ',
    location_lat: 35.7025,
    location_lng: 139.7345,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['デート', '記念日'],
    hashtags: ['イタリアン', '神楽坂', '細工町', '老舗'],
    images: ['https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800&q=90'],
    daysAgo: 2,
  },
  {
    caption:
      '赤城下町の住宅街にある一軒家。表通りから一本入っただけで人通りが消えるので、初めてだと通り過ぎる。'
      + '南イタリアの料理と、専用の窯で焼くピッツァ、手打ちのパスタ。'
      + '神楽坂で「知っている人が行く店」を挙げるならここだと思う',
    rating: 5,
    genre: 'イタリアン',
    price_range: '¥3,001〜¥5,000',
    location_name: 'トラットリア ラ タルタルギーナ',
    location_lat: 35.705,
    location_lng: 139.7362,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['隠れ家', 'デート'],
    hashtags: ['イタリアン', '神楽坂', '南イタリア', '一軒家'],
    images: ['https://images.unsplash.com/photo-1595295333158-4742f28fbd85?w=800&q=90'],
    daysAgo: 6,
  },
  {
    caption:
      'カルミネで料理長をしていた方の店。薪窯で焼くナポリピッツァと、常時100種類以上あるワイン。'
      + 'ビルの5階なので、坂を歩いているだけでは気づかない。'
      + 'ピッツァを一枚食べて帰ってもいいし、ワインを開けて長居してもいい。使い方に幅がある',
    rating: 4,
    genre: 'イタリアン',
    price_range: '¥3,001〜¥5,000',
    location_name: 'エノテカ・ピッツェリア 神楽坂スタジオーネ',
    location_lat: 35.7018,
    location_lng: 139.7415,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['デート', '飲み会'],
    hashtags: ['イタリアン', '神楽坂', 'ナポリピッツァ', 'ワイン'],
    images: ['https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=90'],
    daysAgo: 11,
  },

  /* ── フレンチ ─────────────────────────────── */
  {
    caption:
      '納戸町の住宅街に一軒だけ、14席。ミシュランの星が長く付いている店で、'
      + '神楽坂の賑やかなほうではなく、坂を越えて静かになったあたりにある。'
      + 'このあたりのフレンチを一軒だけ選ぶなら、いまでもここを挙げる',
    rating: 5,
    genre: 'フレンチ',
    price_range: '¥10,001〜',
    location_name: 'ル・マンジュ・トゥー',
    location_lat: 35.701,
    location_lng: 139.7338,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['記念日', 'デート', '隠れ家'],
    hashtags: ['フレンチ', '神楽坂', '納戸町', 'ミシュラン'],
    images: ['https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=90'],
    daysAgo: 4,
  },
  {
    caption:
      '飯田橋の駅を出てすぐ、神楽坂の入口にあるフレンチ。'
      + '日本の旬の食材をフランス料理に寄せる「フランコジャポネ」を掲げている店で、'
      + 'ウェディングもやる規模だから席にゆとりがあって話しやすい。人数がいるときにまず候補に入る',
    rating: 4,
    genre: 'フレンチ',
    price_range: '¥5,001〜¥10,000',
    location_name: '神楽坂 ラリアンス',
    location_lat: 35.7013,
    location_lng: 139.7428,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['記念日', '家族で', 'デート'],
    hashtags: ['フレンチ', '神楽坂', '飯田橋', 'フランコジャポネ'],
    images: ['https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=90'],
    daysAgo: 15,
  },
  {
    caption:
      '1996年、日本で最初のクレープリーとしてこの場所に開いた店。'
      + 'そば粉のガレットを東京で当たり前にしたのは、ほぼこの一軒だと思っている。'
      + 'シードルを合わせるのが本来の形。昼に一人で入っても浮かないので、神楽坂で迷ったらここに来てしまう',
    rating: 5,
    genre: 'フレンチ',
    price_range: '¥1,001〜¥3,000',
    location_name: 'ル ブルターニュ 神楽坂店',
    location_lat: 35.7022,
    location_lng: 139.7405,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['ランチにおすすめ', '一人ランチにおすすめ', 'デート'],
    hashtags: ['ガレット', '神楽坂', 'クレープリー', 'シードル'],
    images: ['https://images.unsplash.com/photo-1519676867240-f03562e64548?w=800&q=90'],
    daysAgo: 1,
  },
  {
    caption:
      '神楽坂の坂を上りきったあたりにある一軒家フレンチ。'
      + 'オーナーシェフが長く続けている店で、このあたりのフレンチの話をすると必ず名前が出る。'
      + '昼のコースがあるので、最初の一回は昼のほうが入りやすいと思う',
    rating: 5,
    genre: 'フレンチ',
    price_range: '¥5,001〜¥10,000',
    location_name: 'ラ・トゥーエル',
    location_lat: 35.7035,
    location_lng: 139.7385,
    prefecture: '東京都',
    area: '神楽坂',
    situations: ['デート', '記念日', '隠れ家'],
    hashtags: ['フレンチ', '神楽坂', '一軒家', 'ランチコース'],
    images: ['https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=90'],
    daysAgo: 22,
  },
]

// ============================================================
// 投入前の検査
//
// 書き込む前に、投稿1件ごとの値がアプリの選択肢と食い違っていないかを見る。
// これは scripts/check-seed.mjs が seed.mjs に対してやっているのと同じ検査で、
// 「入れてから画面で気づく」を避けるためにここでも通す。
// ============================================================
async function checkPosts() {
  const { outputText } = ts.transpileModule(
    fs.readFileSync(path.join(ROOT, 'lib', 'regions.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
  )
  const { nearestArea, PREFECTURE_BY_ID } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  )

  // theme.ts は react-native を import しているので、配列の中身だけ抜き出す。
  const theme = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'theme.ts'), 'utf8')
  const arrayOf = (name) => {
    const src = theme.slice(theme.indexOf(`export const ${name} = [`))
    return [...src.slice(0, src.indexOf(']')).matchAll(/'([^']+)'/g)].map((m) => m[1])
  }
  const GENRES = arrayOf('GENRES')
  const PRICE_RANGES = arrayOf('PRICE_RANGES')
  const SITUATIONS = arrayOf('SITUATIONS')

  const problems = []
  const seen = new Set()

  for (const p of POSTS) {
    const at = `"${p.location_name}"`

    if (seen.has(p.location_name)) problems.push(`${at}: 店名が重複しています`)
    seen.add(p.location_name)

    // 店名60文字・本文1000文字は投稿画面の maxLength と対。
    if (p.location_name.length > 60) problems.push(`${at}: 店名が60文字を超えています`)
    if (p.caption.length > 1000) problems.push(`${at}: 本文が1000文字を超えています`)

    if (!GENRES.includes(p.genre)) problems.push(`${at}: ジャンル '${p.genre}' は選択肢にありません`)
    if (!PRICE_RANGES.includes(p.price_range)) problems.push(`${at}: 価格帯 '${p.price_range}' は選択肢にありません`)
    for (const s of p.situations) {
      if (!SITUATIONS.includes(s)) problems.push(`${at}: シチュエーション '${s}' は選択肢にありません`)
    }
    if (!(p.rating >= 1 && p.rating <= 5)) problems.push(`${at}: rating が 1〜5 ではありません`)
    if (!p.images.length) problems.push(`${at}: 写真がありません`)
    if (p.images.length > 5) problems.push(`${at}: 写真は5枚までです（移行0016）`)

    // 座標から判定したエリアと、書いてあるエリアが一致するか。
    // ずれていると「地図では神楽坂なのに一覧では別の街」になる。
    const hit = nearestArea(p.location_lat, p.location_lng)
    if (!hit) {
      problems.push(`${at}: 8km以内に内蔵エリアがありません（投入時に Geocoding API を消費します）`)
      continue
    }
    const pref = PREFECTURE_BY_ID[hit.area.prefId]?.name
    if (pref !== p.prefecture) problems.push(`${at}: 都道府県が違います（書いてある:${p.prefecture} / 座標:${pref}）`)
    if (hit.area.name !== p.area) {
      problems.push(`${at}: エリアが違います（書いてある:${p.area} / 座標:${hit.area.name} ${Math.round(hit.meters)}m）`)
    }
  }

  if (problems.length) {
    console.error('❌ 投稿データに問題があります。書き込みは行いません。\n')
    for (const p of problems) console.error(`   ・${p}`)
    process.exit(1)
  }
  console.log(`✅ 検査OK: ${POSTS.length}件（ジャンル・価格帯・シチュエーション・座標とエリアの一致）\n`)
}

/** 写真URLが生きているか。死んだURLを入れると画面に穴が開く（fix_dead_demo_images.sql の再発防止） */
async function checkImages() {
  const urls = POSTS.flatMap((p) => p.images)
  const dead = []
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
      if (!res.ok) dead.push(`${res.status} ${url}`)
    } catch (e) {
      dead.push(`取得失敗 ${url}（${e.message}）`)
    }
  }
  if (dead.length) {
    console.error('❌ 写真URLが取得できません。書き込みは行いません。\n')
    for (const d of dead) console.error(`   ・${d}`)
    process.exit(1)
  }
  console.log(`✅ 写真URL ${urls.length}本すべて生存を確認\n`)
}

// ============================================================
// 実行
// ============================================================
console.log(`🦐 @${PROFILE.username} セットアップ  (${new URL(SUPABASE_URL).host})`)
console.log(APPLY ? '   モード: 書き込む (--apply)\n' : '   モード: 確認のみ（書き込むには --apply）\n')

await checkPosts()
await checkImages()

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
  email: EMAIL, password: PASSWORD,
})
if (signInError || !signIn?.user) {
  console.error(`❌ サインインに失敗しました (${EMAIL}): ${signInError?.message}`)
  console.error('   EBICHAN_EMAIL と SEED_PASSWORD を確認してください。')
  process.exit(1)
}
const uid = signIn.user.id

const { data: before, error: beforeError } = await supabase
  .from('profiles').select('*').eq('id', uid).single()
if (beforeError) {
  console.error(`❌ プロフィールを読めませんでした: ${beforeError.message}`)
  process.exit(1)
}

/**
 * 取り違え防止。
 *
 * ★ このスクリプトは投稿を消す。消してよいのは、
 *   もともとの @taro か、既にこのスクリプトが作り替えた @ebichan だけ。
 *   それ以外のアカウントで動いたら、何もせずに止める。
 */
const ALLOWED = new Set(['taro', PROFILE.username])
if (!ALLOWED.has(before.username)) {
  console.error(`❌ 想定外のアカウントです: @${before.username}（${before.display_name}）`)
  console.error(`   このスクリプトが触ってよいのは ${[...ALLOWED].map((u) => '@' + u).join(' / ')} だけです。`)
  process.exit(1)
}

console.log(`👤 いまのプロフィール: @${before.username} / ${before.display_name} / 投稿${before.posts_count}件 / is_demo=${before.is_demo}`)
console.log(`   → @${PROFILE.username} / ${PROFILE.displayName}\n`)

// ---- 1. プロフィール ----------------------------------------
if (APPLY) {
  const { error } = await supabase
    .from('profiles')
    .update({
      username: PROFILE.username,
      display_name: PROFILE.displayName,
      bio: PROFILE.bio,
      photo_url: PROFILE.photoUrl,
      is_public: true,
    })
    .eq('id', uid)
  if (error) {
    console.error(`❌ プロフィール更新に失敗: ${error.message}`)
    process.exit(1)
  }
  console.log('✅ プロフィールを更新しました')
} else {
  console.log('（確認のみ）プロフィールを更新します')
}

// ---- 2. 要らない投稿を消す ----------------------------------
const wanted = new Set(POSTS.map((p) => p.location_name))

const { data: current, error: currentError } = await supabase
  .from('posts').select('id, location_name').eq('user_id', uid)
if (currentError) {
  console.error(`❌ 既存投稿を読めませんでした: ${currentError.message}`)
  process.exit(1)
}

const stale = (current ?? []).filter((p) => !wanted.has(p.location_name))
console.log(`\n🗑️  消す投稿: ${stale.length}件`)
for (const p of stale) {
  if (APPLY) {
    // post_images / likes / comments は ON DELETE CASCADE で一緒に消える（schema.sql）
    const { error } = await supabase.from('posts').delete().eq('id', p.id)
    if (error) {
      console.error(`   ❌ ${p.location_name}: ${error.message}`)
      continue
    }
  }
  console.log(`   ${APPLY ? '🗑️ ' : '  '} ${p.location_name}`)
}

// ---- 3. 投稿を作る ------------------------------------------
const existingByName = new Map((current ?? []).map((p) => [p.location_name, p.id]))
console.log(`\n📝 投稿: ${POSTS.length}件`)

for (const post of POSTS) {
  if (existingByName.has(post.location_name)) {
    console.log(`   ⏭️  ${post.location_name}（投稿済み）`)
    continue
  }
  if (!APPLY) {
    console.log(`      ${post.genre.padEnd(6, '　')} ${post.location_name}`)
    continue
  }

  const createdAt = new Date(Date.now() - post.daysAgo * 86_400_000).toISOString()
  const { data: created, error } = await supabase
    .from('posts')
    .insert({
      user_id: uid,
      caption: post.caption,
      rating: post.rating,
      genre: post.genre,
      price_range: post.price_range,
      location_name: post.location_name,
      location_lat: post.location_lat,
      location_lng: post.location_lng,
      prefecture: post.prefecture,
      area: post.area,
      situations: post.situations,
      hashtags: post.hashtags,
      is_public: true, // 既定は非公開。地図に出すので明示的に公開する
      created_at: createdAt,
    })
    .select('id')
    .single()

  if (error) {
    console.error(`   ❌ ${post.location_name}: ${error.message}`)
    continue
  }

  for (const [position, url] of post.images.entries()) {
    const { error: imgError } = await supabase
      .from('post_images').insert({ post_id: created.id, url, position })
    if (imgError) console.error(`   ⚠️  ${post.location_name} の写真${position + 1}枚目: ${imgError.message}`)
  }
  console.log(`   📸 ${post.genre.padEnd(6, '　')} ${post.location_name}`)
}

// ---- 4. 結果 ------------------------------------------------
const { data: after } = await supabase.from('profiles').select('*').eq('id', uid).single()
await supabase.auth.signOut()

if (!APPLY) {
  console.log('\n（確認のみ。実際に書き込むには --apply を付けてください）')
  process.exit(0)
}

console.log('\n✅ 完了')
console.log(`   @${after.username} / ${after.display_name} / 投稿${after.posts_count}件 / エリア${after.areas_count}`)

if (after.is_demo) {
  console.log('')
  console.log('⚠️  まだ「デモ用のアカウントです」の帯が画面に出ます（is_demo = true）。')
  console.log('   これはアプリ側からは外せません（移行0010 の protect_demo_flag）。')
  console.log('   Supabase の SQL Editor で次を流してください:')
  console.log('     supabase/migrations/0018_ebichan_real_account.sql')
}

console.log('\n📋 ログイン情報:')
console.log(`   メールアドレス : ${EMAIL}`)
console.log('   パスワード     : .env.local の SEED_PASSWORD')
console.log(`   ユーザーID     : @${after.username}`)
