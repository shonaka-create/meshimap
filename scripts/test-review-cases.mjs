/**
 * レビュー(2026-08-29)で見つけたバグ候補の再現テスト。
 *
 * ★ 目的は「直ったこと」ではなく「壊れていること」を先に固定すること。
 *   直す前に走らせると FAIL する。直したら PASS する。
 *
 * テスト用のライブラリは入れていない。Node 24 は .ts を
 * そのまま読めるので、本物の実装をそのまま呼ぶ。
 * react-native / supabase を import しているモジュールは
 * Node からは読めないので、そこはロジックだけを写して見る
 * （写した箇所には ★写し と書いてある）。
 *
 * 実行: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-review-cases.mjs
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (rel) => import(`file://${join(root, rel).replace(/\\/g, '/')}`)
const read = (rel) => readFileSync(join(root, rel), 'utf8')

let failed = 0
let passed = 0
let open = 0

/**
 * @param opts.open true なら「まだ直していない既知のバグ」。
 *   落ちても異常終了にしない。直したら opts.open を外すこと
 *   （外し忘れると、直ったことに誰も気付けない。
 *    そのために、通ってしまったほうを失敗として扱う）。
 */
function check(id, title, fn, opts = {}) {
  let err = null
  try {
    fn()
  } catch (e) {
    err = e
  }

  if (err && opts.open) {
    open++
    console.log(`OPEN  ${id}  ${title}`)
    console.log(`      ${err.message.split('\n').join('\n      ')}`)
    return
  }
  if (err) {
    failed++
    console.log(`FAIL  ${id}  ${title}`)
    console.log(`      ${err.message.split('\n').join('\n      ')}`)
    return
  }
  if (opts.open) {
    failed++
    console.log(`FAIL  ${id}  ${title}`)
    console.log('      直っているのに未対応(open)のままになっている。opts.open を外すこと')
    return
  }
  passed++
  console.log(`PASS  ${id}  ${title}`)
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

/* ══════════════════════════════════════════════════════════
 * A. 検索: PostgREST の or() フィルタを文字列連結で組んでいる
 *    mobile/app/(tabs)/search.tsx:74,84
 *
 * PostgREST の or=(...) は「トップレベルのカンマ」で条件を割り、
 * 各条件を col.op.value として読む。検索語をそのまま埋めると、
 * カンマ・括弧を含む語で条件の切れ目が動く。
 * ══════════════════════════════════════════════════════════ */

/**
 * ★写し: search.tsx が組み立てているフィルタ文字列。
 *   値の作り方だけは本物（filters.ts）を呼ぶ。
 *   ここを写しにすると、実装を直してもテストが直らない。
 */
const { pgContains } = await load('mobile/src/lib/filters.ts')

function buildAccountFilter(q) {
  return `display_name.ilike.${pgContains(q)},username.ilike.${pgContains(q)}`
}
function buildPostFilter(q) {
  return `location_name.ilike.${pgContains(q)},caption.ilike.${pgContains(q)}`
}

/**
 * PostgREST の or 引数を、向こうと同じ規則で割る。
 *
 *   ・括弧の内側のカンマは区切りにならない
 *   ・二重引用符の内側は、カンマも括弧もただの文字
 *   ・引用符の中の `\` は次の1文字を逃がす
 */
function splitTopLevel(filter) {
  const out = []
  let depth = 0
  let quoted = false
  let escaped = false
  let cur = ''

  for (const ch of filter) {
    if (escaped) { cur += ch; escaped = false; continue }
    if (quoted) {
      if (ch === '\\') { cur += ch; escaped = true; continue }
      if (ch === '"') quoted = false
      cur += ch
      continue
    }
    if (ch === '"') { quoted = true; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }

  out.push(cur)
  if (quoted) throw new Error(`引用符が閉じていない: ${filter}`)
  if (depth !== 0) throw new Error(`括弧が閉じていない: ${filter}`)
  return out
}

/** 1条件を col / op / value に解く。PostgREST と同じく最初の2つの . で割る */
const KNOWN_OPS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'cs', 'cd', 'fts', 'plfts', 'phfts', 'wfts', 'not',
])
function parseCond(cond) {
  // 値が ( で始まると、PostgREST はそこを条件のまとまりとして読みにいく
  assert(!cond.startsWith('('), `条件のまとまり扱いになった: ${JSON.stringify(cond)}`)
  const a = cond.indexOf('.')
  const b = cond.indexOf('.', a + 1)
  assert(a > 0 && b > a, `col.op.value の形になっていない: ${JSON.stringify(cond)}`)
  const op = cond.slice(a + 1, b)
  assert(KNOWN_OPS.has(op), `演算子として読めない: ${JSON.stringify(op)}`)

  let value = cond.slice(b + 1)
  // 引用符付きの値は、中身を取り出して逃がしを戻す
  if (value.startsWith('"')) {
    assert(value.endsWith('"') && value.length >= 2,
      `引用符が閉じていない値: ${JSON.stringify(value)}`)
    value = value.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return { col: cond.slice(0, a), op, value }
}

/**
 * 検索語が、そのままの形で「1つの値」として届くこと。
 * ここが崩れると、打った語と実際に検索される語が食い違う。
 */
function assertFilterSurvives(q) {
  for (const [name, filter] of [
    ['アカウント', buildAccountFilter(q)],
    ['投稿', buildPostFilter(q)],
  ]) {
    const conds = splitTopLevel(filter)
    assert(
      conds.length === 2,
      `${name}検索: 検索語 ${JSON.stringify(q)} でフィルタが ${conds.length} 条件に割れた: ${filter}`
    )
    for (const c of conds) {
      const { value } = parseCond(c)
      assert(
        value === `%${q}%`,
        `${name}検索: 検索語 ${JSON.stringify(q)} が ${JSON.stringify(value)} として届く`
      )
    }
  }
}

check('A-1', '検索: 普通の語（対照。これは通る）', () => {
  assertFilterSurvives('ラーメン')
  assertFilterSurvives('meshitaro')
})

check('A-2', '検索: カンマを含む語で検索が壊れない', () => {
  // 「新宿, 焼肉」のように区切って打つ人は普通にいる
  assertFilterSurvives('新宿, 焼肉')
})

check('A-3', '検索: 括弧を含む店名で検索が壊れない', () => {
  // 「(株)」「支店名(本店)」など。半角括弧の店名は実在する
  assertFilterSurvives('やきとり(本店)')
})

check('A-4', '検索: 閉じ括弧だけを含む語で壊れない', () => {
  assertFilterSurvives(')')
})

check('A-5', '検索: PostgREST のフィルタ構文を注入できない', () => {
  // 検索欄から条件を1つ足せてしまうと、意図しない列で絞れる。
  // RLS があるので情報は漏れないが、フィルタの組み立てとしては誤り。
  const q = 'x%,is_public.eq.false,caption.ilike.%y'
  const filter = buildPostFilter(q)
  const conds = splitTopLevel(filter)
  assert(
    conds.length === 2,
    `検索欄から条件を注入できた（${conds.length} 条件）: ${JSON.stringify(conds)}`
  )
  assertFilterSurvives(q)
})

check('A-0', '検索: 実装が値を素で埋めていない（写しの見張り）', () => {
  // ★ 上の A-1〜A-6 はフィルタの組み立て方を写して見ている。
  //   写しだけだと、実装が元のやり方に戻っても気付けない。
  //   実物の .or() の中身を見て、値が生のままでないことを確かめる。
  for (const rel of ['mobile/app/(tabs)/search.tsx', 'mobile/app/(tabs)/index.tsx']) {
    const src = read(rel)

    for (const call of src.matchAll(/\.or\(/g)) {
      const rest = src.slice(call.index + call[0].length)

      // ★ テンプレートリテラル以外の組み立て方に逃げていないこと。
      //   `.or(buildFilter(q))` や文字列連結に変えられると、
      //   下の中身の検査をすり抜けてしまう。
      assert(
        rest.startsWith('`'),
        `${rel}: .or() がテンプレートリテラル以外で組まれている: ${rest.slice(0, 60)}`
      )

      const end = rest.indexOf('`', 1)
      assert(end > 0, `${rel}: .or() のテンプレートリテラルが閉じていない`)
      const filter = rest.slice(1, end)

      // ${...} の埋め込みは、必ず pgValue / pgContains を通っていること
      for (const slot of filter.matchAll(/\$\{([^}]*)\}/g)) {
        assert(
          /^\s*pg(Value|Contains)\(/.test(slot[1]),
          `${rel}: .or() に値を素で埋めている: \${${slot[1]}}`
        )
      }
    }
  }
})

check('A-6', '検索: 引用符そのものを打たれても閉じ方が壊れない', () => {
  // 値を引用符で囲む直し方をしたので、引用符自体が入ってきたときに
  // そこで値が終わってしまわないことを見る
  assertFilterSurvives('"')
  assertFilterSurvives('お店"の"名前')
  assertFilterSurvives('バックスラッシュ\\ と "引用符"')
})

/* ══════════════════════════════════════════════════════════
 * B. 禁止語フィルタの穴
 *    mobile/src/lib/moderation.ts / supabase/migrations/0012
 *
 * SAFE_PHRASES に「グレイプ」が入っている理由は
 * 「『レイプ』を含むから」と書いてある。ところが PROHIBITED_JA に
 * 「レイプ」が無い。守るために置いた例外だけが残っている。
 * ══════════════════════════════════════════════════════════ */

const { containsProhibitedContent } = await load('mobile/src/lib/moderation.ts')

check('B-1', 'モデレーション: 通してよい語は通る（対照）', () => {
  assert(!containsProhibitedContent('グレイプフルーツサワー'), 'グレイプフルーツが弾かれた')
  assert(!containsProhibitedContent('大麻駅前の喫茶店'), '大麻駅が弾かれた')
  assert(!containsProhibitedContent('クソうまいラーメン'), 'クソうまいが弾かれた')
})

check('B-2', 'モデレーション: 日本語の「レイプ」を弾く', () => {
  assert(containsProhibitedContent('レイプ'), '「レイプ」が素通りする')
  assert(containsProhibitedContent('れいぷ'), '「れいぷ」が素通りする')
})

check('B-3', 'モデレーション: 例外語は例外のままにする', () => {
  // B-2 を直しても、グレープフルーツの別表記が巻き添えにならないこと
  assert(!containsProhibitedContent('グレイプフルーツ'), 'グレイプフルーツが巻き添えになった')
})

/* ══════════════════════════════════════════════════════════
 * C. 外部地図リンク: 空の destination_place_id が付く
 *    mobile/src/lib/maps.ts:43
 *
 * maps.ts は react-native を import しているので Node から読めない。
 * URL を組み立てている式だけをここに写して見る。 ★写し
 * ══════════════════════════════════════════════════════════ */

const GOOGLE_DIR = 'https://www.google.com/maps/dir/?api=1'
function openDirectionsUrl(lat, lng, label) {
  void label
  const dest = `${lat},${lng}`
  return `${GOOGLE_DIR}&destination=${encodeURIComponent(dest)}`
}

check('C-1', '行き方リンク: 値の無いクエリパラメータを付けない', () => {
  const url = openDirectionsUrl(35.6812, 139.7671, '麺屋 こうじ')
  const params = new URL(url).searchParams
  for (const [k, v] of params) {
    assert(v !== '', `${k} が空のまま URL に載っている: ${url}`)
  }
})

check('C-2', '行き方リンク: 実装が写しと一致している（写しの見張り）', () => {
  const src = read('mobile/src/lib/maps.ts')
  const fn = src.slice(src.indexOf('export function openDirections'))
  // コメントは落とす。なぜ付けないのかは本文に書いてあるので、
  // 語が出てくるだけで落とすと直したそばから失敗する。
  const body = fn
    .slice(0, fn.indexOf('\n}'))
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert(
    !/destination_place_id/.test(body),
    'maps.ts が destination_place_id を組み立てに戻している'
  )
})

/* ══════════════════════════════════════════════════════════
 * D. 投稿画像の縮小: 「長辺1600px」になっていない
 *    mobile/app/post/new.tsx:191
 *
 * resize は width しか渡していないので、縦長の写真は
 * 長辺が 1600 を大きく超えたまま上がる。 ★写し
 * ══════════════════════════════════════════════════════════ */

const MAX_EDGE = 1600

/** ★写し: post/new.tsx の resizeToLongEdge。縮める必要が無ければ null */
function resizeArg(w, h) {
  if (!w || !h) return null
  if (Math.max(w, h) <= MAX_EDGE) return null
  return w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE }
}
/** expo-image-manipulator は片方だけ渡すと縦横比を保つ */
function resultSize(w, h, arg) {
  if (!arg) return { width: w, height: h }   // resize を渡さない＝原寸のまま
  const scale = arg.width !== undefined ? arg.width / w : arg.height / h
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

check('D-1', '画像縮小: 横長の写真の長辺が1600px以下（対照）', () => {
  const out = resultSize(4032, 3024, resizeArg(4032, 3024))
  assert(Math.max(out.width, out.height) <= MAX_EDGE,
    `長辺が ${Math.max(out.width, out.height)}px`)
})

check('D-2', '画像縮小: 縦長の写真の長辺が1600px以下', () => {
  // iPhone の縦持ち写真。これが素通りしている
  const out = resultSize(3024, 4032, resizeArg(3024, 4032))
  assert(Math.max(out.width, out.height) <= MAX_EDGE,
    `縦長写真の長辺が ${Math.max(out.width, out.height)}px のまま上がる`)
})

check('D-3', '画像縮小: 元から小さい写真を引き伸ばさない', () => {
  for (const [w, h] of [[800, 600], [600, 800], [1600, 1600]]) {
    const out = resultSize(w, h, resizeArg(w, h))
    assert(out.width === w && out.height === h,
      `${w}x${h} が ${out.width}x${out.height} になった`)
  }
})

check('D-5', '画像縮小: サイズが読めない写真を引き伸ばさない', () => {
  // ライブラリが width/height を返さないことがある。
  // そこで 1600 を決め打ちすると、小さい写真が拡大される。
  assert(resizeArg(undefined, undefined) === null,
    'サイズ不明のときに resize を渡している（引き伸ばしうる）')
  assert(resizeArg(0, 0) === null, '0 のときに resize を渡している')
})

check('D-6', '画像縮小: 正方形の大きい写真も縮む', () => {
  const out = resultSize(3000, 3000, resizeArg(3000, 3000))
  assert(Math.max(out.width, out.height) <= MAX_EDGE,
    `3000x3000 が ${out.width}x${out.height} のまま`)
})

check('D-4', '画像縮小: 実装が写しと一致している（写しの見張り）', () => {
  const src = read('mobile/app/post/new.tsx')
  assert(
    /resizeToLongEdge\(/.test(src),
    'post/new.tsx が長辺で縮める組み立てをやめている。D の写しを更新すること'
  )
})

/* ══════════════════════════════════════════════════════════
 * E. 地図の枠(on_map)の数え方が場所によって食い違う
 *    supabase/migrations/0013_map_audience_gate.sql
 *
 * 数える側の3か所のうち、
 *   my_map_quota()  … status='accepted' で絞る
 *   map_pins()      … status='accepted' で絞る
 *   set_follow_on_map_default() / set_map_visible() … 絞っていない
 * ため、承認待ち(pending)のフォローが枠を食う。
 * DB を立てずに見るために、SQL の該当ブロックを読んで確かめる。
 * ══════════════════════════════════════════════════════════ */

/**
 * 移行を番号順に読み、その関数を「最後に定義したもの」を返す。
 *
 * ★ 1つのファイルだけを見ないこと。
 *   移行は CREATE OR REPLACE で後から上書きされるので、
 *   実際に効いているのは最後の定義。0013 だけを見ていると、
 *   0014 で直したあともテストが落ち続ける。
 */
const MIGRATIONS = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => read(join('supabase', 'migrations', f)))

function funcBody(name) {
  let found = null
  for (const sql of MIGRATIONS) {
    let from = 0
    for (;;) {
      const i = sql.indexOf(`FUNCTION public.${name}(`, from)
      if (i < 0) break
      const end = sql.indexOf('$$;', i)
      assert(end >= 0, `${name} の終端が読めない`)
      found = sql.slice(i, end)
      from = end + 3
    }
  }
  assert(found !== null, `${name} の定義が migrations に見つからない`)
  return found
}

/**
 * 「枠を何人ぶん使っているか」を数えている SELECT が
 * status='accepted' で絞っているか。
 *
 * 数え上げの SELECT だけを取り出して見る。関数の別の場所（例えば
 * set_map_visible 冒頭の「フォローしているか」の確認）にある
 * status の条件を数え上げの条件と取り違えないため。
 */
function countsFilterByStatus(name) {
  const body = funcBody(name)
  const i = body.indexOf('COUNT(*)')
  assert(i >= 0, `${name} に枠の数え上げが無い`)
  const rest = body.slice(i)
  const end = rest.indexOf(';')
  const stmt = end >= 0 ? rest.slice(0, end) : rest
  assert(stmt.includes('f.on_map'), `${name} の数え上げが on_map を見ていない`)
  return /f\.status\s*=\s*'accepted'/.test(stmt)
}

check('E-1', '地図の枠: my_map_quota は承認済みだけを数える（対照）', () => {
  assert(countsFilterByStatus('my_map_quota'),
    'my_map_quota が status で絞っていない')
})

check('E-2', '地図の枠: set_map_visible も承認済みだけを数える', () => {
  assert(countsFilterByStatus('set_map_visible'),
    'set_map_visible が承認待ち(pending)のフォローまで枠に数えている')
})

check('E-3', '地図の枠: 新規フォローの既定値も承認済みだけを数える', () => {
  assert(countsFilterByStatus('set_follow_on_map_default'),
    'set_follow_on_map_default が承認待ち(pending)のフォローまで枠に数えている')
})

/* ══════════════════════════════════════════════════════════
 * F. 通報の送信が失敗しても画面に何も出ない
 *    mobile/src/components/ReportDialog.tsx:44-48
 *
 * 失敗時の分岐が setDetail((d) => d)（何もしない）と
 * console.warn だけ。押した人には成功とも失敗とも分からない。
 * Guideline 1.2 の必須導線なので、静かに落ちてはいけない。
 * ══════════════════════════════════════════════════════════ */

check('F-1', '通報: 送信失敗を画面に出している', () => {
  const src = read('mobile/src/components/ReportDialog.tsx')
  assert(
    !/setDetail\(\(d\)\s*=>\s*d\)/.test(src),
    '失敗時の分岐が setDetail((d) => d)（何もしない）のまま'
  )
  // 送信の失敗を拾っている分岐の中で、画面に出す手を打っているか
  const i = src.indexOf('const submit')
  assert(i >= 0, 'submit が見つからない')
  const submit = src.slice(i, src.indexOf('\n  }', i))
  assert(
    /setError\(/.test(submit),
    '通報の送信が失敗しても、画面に何も出ないまま閉じられる'
  )
  assert(
    /{error/.test(src) || /error &&/.test(src),
    '失敗を state に持っているだけで、画面に描いていない'
  )
})

/* ══════════════════════════════════════════════════════════
 * G. アカウント削除で Storage の写真が残る
 *    supabase/migrations/0001:472  delete_my_account()
 *
 * delete_my_account() は auth.users を消すだけ。DB の行は
 * ON DELETE CASCADE で連鎖するが、Storage のオブジェクトは
 * DB の外にあるので残る。両バケットは public なので、
 * URL を控えていれば退会後もその写真が開ける。
 *
 * SQL からは実体を消せない（storage.objects を消しても
 * ファイルは残る）ので、退会の直前に端末から消す。
 * ★ 順番が命。先にアカウントを消すとトークンが無効になり、
 *   Storage のポリシーで弾かれて二度と消せなくなる。
 * ══════════════════════════════════════════════════════════ */

check('G-1', 'アカウント削除: 写真の実体も消している', () => {
  const src = read('mobile/src/hooks/useAuth.tsx')
  const i = src.indexOf('const deleteAccount')
  assert(i >= 0, 'deleteAccount が見つからない')
  const body = src.slice(i, src.indexOf('}, [', i))

  assert(
    body.includes('removeMyStorageFiles'),
    'アカウント削除で Storage の写真を消していない'
  )

  const cleanupAt = body.indexOf('removeMyStorageFiles')
  const rpcAt = body.indexOf("rpc('delete_my_account')")
  assert(rpcAt >= 0, 'delete_my_account の呼び出しが見つからない')
  assert(
    cleanupAt < rpcAt,
    '写真を消す前にアカウントを消している。トークンが無効になり、写真が二度と消せなくなる'
  )
})

check('G-2', 'アカウント削除: 写真を消せなかったら黙って進めない', () => {
  // 進めた瞬間に、その写真は「公開されたまま誰にも消せない」ファイルになる。
  // 一度止めて本人に伝えること。
  const src = read('mobile/src/hooks/useAuth.tsx')
  const i = src.indexOf('const deleteAccount')
  const body = src.slice(i, src.indexOf('\n  )', i))
  assert(
    /failed\.length\s*>\s*0\s*&&\s*!evenIfPhotosRemain[\s\S]{0,200}throw new Error\(PHOTO_CLEANUP_FAILED\)/
      .test(body),
    '「消せなかったときだけ止める」になっていない'
      + '（常に投げると退会できず、投げないと写真が残る）'
  )
  const thrownAt = body.indexOf('PHOTO_CLEANUP_FAILED')
  const rpcAt = body.indexOf("rpc('delete_my_account')")
  assert(thrownAt < rpcAt, '退会 RPC のあとで止めても手遅れ')
})

check('G-3', 'アカウント削除: それでも退会できる道が残っている', () => {
  // 「写真が消せない限り退会できない」は Guideline 5.1.1(v) を満たさない
  const hook = read('mobile/src/hooks/useAuth.tsx')
  assert(
    /evenIfPhotosRemain/.test(hook),
    '写真を消せないときに退会する手段が無い'
  )
  const screen = read('mobile/app/settings/index.tsx')
  assert(
    /PHOTO_CLEANUP_FAILED/.test(screen) && /evenIfPhotosRemain: true/.test(screen),
    '画面側が、写真を消せなかったことを本人に伝えて選ばせていない'
  )
})

check('G-4', 'アカウント削除: 深いパスの写真も消す', () => {
  // 0014 より前は Storage の置き場所を見ていなかったので、
  // uid/a/b/c.jpg のような深いオブジェクトが残っている可能性がある
  const src = read('mobile/src/lib/storageCleanup.ts')
  assert(
    /collectFiles\([^)]*depth\s*\+\s*1\)/.test(src),
    'Storage の後片付けが階層を辿らない（段数を決め打ちしている）'
  )
  // ★ 打ち切ったときに空配列を返さないこと。
  //   返すと「消し終えた」と誤解され、退会まで進んでしまう。
  const guard = src.slice(src.indexOf('depth >= MAX_DEPTH'))
  assert(
    /throw new Error/.test(guard.slice(0, 300)),
    '深さの打ち切りを「消し終えた」として扱っている（写真が黙って残る）'
  )
})

/* ══════════════════════════════════════════════════════════
 * P. 月間ランキングがブロックを迂回する
 *    supabase/migrations/0009_premium_gates.sql
 *
 * profiles の RLS はブロック相手を隠すが、monthly_ranking() は
 * SECURITY DEFINER で profiles を直接 JOIN するため通らない。
 * ブロックした相手が上位に入っていれば名前も写真も出てしまう。
 * ══════════════════════════════════════════════════════════ */

check('P-1', 'ランキング: ブロックした相手を出さない', () => {
  const body = funcBody('monthly_ranking')
  assert(
    /NOT\s+public\.has_block_with\(\s*b\.user_id\s*\)/.test(body),
    'monthly_ranking が、返す行の相手をブロック判定に掛けていない'
      + '（SECURITY DEFINER なので profiles の RLS は効かない）'
  )
  // 自分の行だけは、何があっても返ること
  assert(
    /b\.user_id\s*=\s*auth\.uid\(\)\s*OR/.test(body),
    'ブロック判定で自分の行まで落としている'
  )
})

/* ══════════════════════════════════════════════════════════
 * Q. Storage へのアップロードが自分のフォルダに限られていない
 *
 * アプリ側は `${uid}/...` で上げていて、コメントにも
 * 「先頭フォルダ = 自分のUID を要求する」と書いてあるが、
 * INSERT ポリシーは「ログイン済み かつ 対象バケット」だけだった。
 * public バケットなので、任意のパスに任意のファイルを置ける。
 * ══════════════════════════════════════════════════════════ */

/** storage.objects のポリシーの、最後に効く定義を拾う */
function storagePolicies(action) {
  const all = [read(join('supabase', 'schema.sql')), ...MIGRATIONS].join('\n')
  const re = new RegExp(
    `CREATE POLICY "[^"]+" ON storage\\.objects FOR ${action}([\\s\\S]*?);`,
    'g'
  )
  return [...all.matchAll(re)].map((m) => m[0])
}

/** そのポリシー名が、どこかで DROP されているか */
function isDropped(policyName) {
  const all = [read(join('supabase', 'schema.sql')), ...MIGRATIONS].join('\n')
  return all.includes(`DROP POLICY IF EXISTS "${policyName}" ON storage.objects`)
}

const FOLDER_GUARD = /auth\.uid\(\)::text\s*=\s*\(storage\.foldername\(name\)\)\[1\]/

check('Q-1', 'Storage: 自分のフォルダ以外へは置けない', () => {
  const inserts = storagePolicies('INSERT')
  assert(inserts.length > 0, 'storage.objects の INSERT ポリシーが無い')

  const last = inserts[inserts.length - 1]
  assert(
    FOLDER_GUARD.test(last),
    'INSERT ポリシーが「先頭フォルダ = 自分のUID」を要求していない。任意のパスへ置ける'
  )

  // ★ 緩いポリシーが1本でも生き残っていれば意味が無い。
  //   RLS は「どれか1つ通れば通る」ので、貼り替えではなく
  //   消してから貼る必要がある。
  for (const policy of inserts) {
    if (FOLDER_GUARD.test(policy)) continue
    const name = policy.match(/CREATE POLICY "([^"]+)"/)[1]
    assert(
      isDropped(name),
      `置き場所を見ない INSERT ポリシー "${name}" が DROP されずに残っている`
    )
  }
})

check('Q-2', 'Storage: upsert のための UPDATE も自分のフォルダに限る', () => {
  const updates = storagePolicies('UPDATE')
  assert(updates.length > 0, 'storage.objects の UPDATE ポリシーが無い（upsert が必ず弾かれる）')

  const last = updates[updates.length - 1]
  const using = last.slice(last.indexOf('USING'), last.indexOf('WITH CHECK'))
  const check = last.slice(last.indexOf('WITH CHECK'))

  assert(using.length > 0 && FOLDER_GUARD.test(using),
    'UPDATE の USING が「先頭フォルダ = 自分のUID」を要求していない（他人のファイルを書き換えられる）')
  assert(check.length > 0 && FOLDER_GUARD.test(check),
    'UPDATE の WITH CHECK が「先頭フォルダ = 自分のUID」を要求していない（他人のフォルダへ移せる）')
})

/* ══════════════════════════════════════════════════════════
 * H / J / K / L / M
 *   「通信に失敗しただけ」を、取り返しのつかない結果として
 *   見せてしまう類の誤り。どれも画面の見せ方の問題なので、
 *   実装のかたちを見張るところまでにしてある。
 * ══════════════════════════════════════════════════════════ */

check('H-1', 'プロフィール: 通信エラーを「表示できません」と混ぜない', () => {
  const src = read('mobile/src/components/ProfileView.tsx')
  assert(/setLoadError\(true\)/.test(src),
    '取得エラーを「見つからない」と同じ画面で処理している')
  assert(/loadError && !profile/.test(src),
    '取得エラー専用の画面を出していない')
})

check('H-2', 'プロフィール: 再取得に成功したら表示が戻る', () => {
  const src = read('mobile/src/components/ProfileView.tsx')
  assert(/setNotFound\(false\)/.test(src),
    'notFound を false に戻していない。一度失敗すると、更新に成功しても戻らない')
})

check('J-1', 'ユーザーID: 「確かめられなかった」を「使われている」にしない', () => {
  const hook = read('mobile/src/hooks/useAuth.tsx')
  assert(/'unknown'/.test(hook),
    'isUsernameAvailable がエラーと「使用済み」を同じ値に畳んでいる')

  const signUp = read('mobile/app/(auth)/sign-up.tsx')
  assert(/availability === 'unknown'/.test(signUp),
    '登録画面が unknown のときに進めない（圏外だと登録できない）')

  // 確かめずに登録して衝突したときは、DB のトリガーが落ちる。
  // Supabase はそれを英語の一文にまとめて返すので、日本語に直しておく。
  assert(/Database error saving new user/.test(hook),
    '空き確認を通せずに登録して衝突したとき、素の英語エラーがそのまま出る')

  const edit = read('mobile/app/settings/edit-profile.tsx')
  assert(/result === 'taken'/.test(edit),
    'プロフィール編集が unknown を「使われている」にしている')
})

check('K-1', '投稿詳細: 戻るたびに全画面ローディングにしない', () => {
  const src = read('mobile/app/post/[id].tsx')
  assert(/shownId/.test(src),
    'focus のたびに setLoading(true) していて、戻るたび中身が消える')
  assert(/shownId\.current === id/.test(src),
    '同じ投稿かどうかを見ていない')
})

check('K-2', '投稿詳細: 別の投稿へ移ったら前の投稿を残さない', () => {
  // 「一度でも出したか」の真偽値だけで持つと、別の投稿を開いても
  // 取得が終わるまで前の店の写真と本文が見えてしまう
  const src = read('mobile/app/post/[id].tsx')
  assert(/if \(!samePost\) \{[\s\S]{0,200}setPost\(null\)/.test(src),
    '別の投稿に移ったときに、前の投稿を消していない')
})

check('K-3', '投稿詳細: 遅れて返った取得で新しい投稿を上書きしない', () => {
  const src = read('mobile/app/post/[id].tsx')
  assert(/mine !== seq\.current/.test(src),
    '取得に世代の見張りが無い。前の取得が遅れて返ると新しい投稿を上書きする')
})

check('L-1', '公開切替: 一括承認の失敗を伝える', () => {
  const src = read('mobile/app/settings/index.tsx')
  const i = src.indexOf('自動承認')
  assert(i >= 0, '自動承認の処理が見つからない')
  assert(/acceptErr/.test(src),
    'pending の一括承認の戻り値を検査していない')
})

check('M-1', 'アイコン変更: 前の画像を残さない（編集画面）', () => {
  const src = read('mobile/app/settings/edit-profile.tsx')
  assert(/deleteAvatarByUrl\(/.test(src),
    'アイコンを変えても前の画像を消していない（public バケットに残る）')

  // 保存が通る前に消すと、失敗したときにアイコンだけ消える
  const save = src.slice(src.indexOf('const save ='))
  const updateAt = save.indexOf(".from('profiles').update(")
  const removeAt = save.indexOf('deleteAvatarByUrl(')
  assert(updateAt >= 0 && removeAt > updateAt,
    '保存が通る前に前のアイコンを消している')
})

check('M-2', 'アイコン変更: プロフィールから変えても前の画像を残さない', () => {
  // アイコンを押して直接変えられる経路を足したので、そちらも同じ順序で消すこと
  const src = read('mobile/src/components/ProfileView.tsx')
  assert(/deleteAvatarByUrl\(/.test(src),
    'プロフィールから変えたときに前の画像を消していない')

  const fn = src.slice(src.indexOf('const replacePhoto ='))
  const body = fn.slice(0, fn.indexOf('\n  }, ['))
  const updateAt = body.indexOf(".from('profiles').update(")
  const removeAt = body.indexOf('deleteAvatarByUrl(')
  assert(updateAt >= 0 && removeAt > updateAt,
    '保存が通る前に前のアイコンを消している')
})

check('M-3', 'アイコン変更: 選ぶ・上げる・消すの実装が1つにまとまっている', () => {
  // 2画面から同じことをするので、分かれていると片方だけ直る
  const lib = read('mobile/src/lib/avatar.ts')
  for (const fn of ['pickAvatarImage', 'uploadAvatar', 'deleteAvatarByUrl']) {
    assert(new RegExp(`export (async )?function ${fn}`).test(lib),
      `avatar.ts に ${fn} が無い`)
  }
  for (const rel of ['mobile/app/settings/edit-profile.tsx', 'mobile/src/components/ProfileView.tsx']) {
    assert(/from '.*lib\/avatar'/.test(read(rel)),
      `${rel} が avatar.ts を使っていない（実装が二重になっている）`)
  }
})

/* ══════════════════════════════════════════════════════════ */

console.log('')
console.log(`${passed} passed / ${failed} failed / ${open} open（未対応の既知バグ）`)
process.exit(failed > 0 ? 1 : 0)
