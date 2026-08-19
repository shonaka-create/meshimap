/**
 * 投稿テキストの下限フィルタ。
 *
 * App Store Review Guideline 1.2 は UGC アプリに
 * 「不適切な内容をあらかじめ取り除く仕組み」を求めている。
 * 通報とブロックは既にあるが、あれは出てしまった後の始末なので、
 * 出る前に止めるものが別に要る。
 *
 * ★ ここは万能な判定器ではない。語の一致しか見ておらず、
 *   文脈も画像も読まない。狙いは「明らかに出してはいけない語を
 *   保存させない」ことだけで、残りは通報とブロックで拾う。
 *
 * ★ 過検知のほうが害が大きい。
 *   飲食店のレビューは褒め言葉が汚い。「バカうまい」「クソうまい」
 *   「死ぬほど美味い」「アホみたいな量」はどれも肯定的な感想で、
 *   これを弾くとアプリが使えなくなる。だから
 *   「バカ」「クソ」「アホ」「デブ」といった単体の語は入れていない。
 *   入れてよいのは、飲食の話に出てくる余地が無い語だけ。
 *
 * ★ 同じ内容が supabase/migrations/0012_content_moderation.sql にもある。
 *   端末側の判定は、アプリを改造されるか API を直接叩かれれば素通しになる。
 *   最後に止めるのは DB のトリガー。こちらは「押す前に教える」ため。
 *   語が食い違うと片方だけ通る穴になるので、
 *   `npm run check:moderation` が毎回一致を確認する。
 */

/**
 * 検知したときにユーザーへ出す文言。
 *
 * ★ どの語に当たったかは絶対に出さない。
 *   出すと「この語を避ければ通る」と教えることになり、
 *   フィルタを回避するための道具になる。
 */
export const PROHIBITED_CONTENT_MESSAGE =
  '不適切な表現が含まれている可能性があります。内容を修正してから再度お試しください。'

/**
 * 判定の前に取り除く、無害な語。
 *
 * 禁止語は部分一致で見るので、無害な語の中に禁止語が入っていると
 * 巻き添えで弾かれる。飲食の言葉にはこれが実際にある。
 * 語を消すのではなく、こちらを先に抜くほうが取りこぼしが少ない。
 */
export const SAFE_PHRASES: readonly string[] = [
  // 「レイプ」を含む。グレープフルーツの別表記として実際に使われる
  'グレイプ',
  // 「大麻」を含む。北海道江別市の地名（大麻駅・大麻銀座商店街）
  '大麻駅',
  '大麻銀座',
  '大麻中町',
  '大麻東町',
]

/**
 * 日本語の禁止語。正規化した本文に対する部分一致で見る。
 *
 * ここに入れなかったもの（意図的に外している。戻さないこと）:
 *
 *   シャブ       … 「シャブシャブ」。この一語でしゃぶしゃぶの店が全滅する
 *   麻薬         … 「麻薬卵」「麻薬とうもろこし」は実在する韓国料理の名前
 *   支那         … 「支那そば」はラーメンの一般的なメニュー名
 *   殺す         … 「悩殺する」「相殺する」に含まれる。脅迫の言い回しだけ入れた
 *   4ね          … 「4年」「4ねん」に含まれる
 *   ちんちん     … 名古屋方言で「熱々」。「ちんちん電車」もある
 *   フェラ       … 「フェラーリ」に含まれる
 *   チョン       … 短すぎて無関係な語に当たる
 *   バカ/馬鹿    … 「バカうま」「馬鹿でかい」は褒め言葉
 *   クソ         … 「クソうまい」は褒め言葉。「クソ野郎」のように向けた形だけ入れた
 *   アホ         … 「アホみたいに美味い」は褒め言葉
 *   デブ         … 「デブ活」は食べ歩きの肯定的なタグ
 *   ブス         … 「ブスッと刺す」に含まれる
 *   処女/童貞    … 「処女作」「処女航海」は普通の語
 *   非人         … 「非人道的」に含まれる
 */
export const PROHIBITED_JA: readonly string[] = [
  // ── 露骨な性的表現 ──
  'セックス',
  'せっくす',
  'フェラチオ',
  'クンニ',
  'オナニー',
  'まんこ',
  'マンコ',
  'ちんぽ',
  'チンポ',
  'ちんこ',
  'チンコ',
  'ヤリマン',
  'av女優',
  '風俗嬢',
  'エロ動画',
  'エロ画像',
  '裏ビデオ',
  '売春',
  '援助交際',
  '援交',
  'ポルノ',
  '児童ポルノ',

  // ── 差別・ヘイト ──
  'キチガイ',
  'きちがい',
  '気違い',
  '基地外',
  'ガイジ',
  '池沼',
  '土人',
  '穢多',

  // ── 脅迫・暴力を助長する表現 ──
  // 「殺す」単体は普通の語に含まれるので、向けた形だけを見る
  '死ね',
  '氏ね',
  'ぶっ殺',
  '殺すぞ',
  '殺してやる',
  '殺害予告',
  '自殺しろ',
  '死んで詫び',

  // ── 強い侮辱・嫌がらせ ──
  'くたばれ',
  'クソ野郎',
  'くそ野郎',
  'ゴミクズ',
  '消え失せろ',
  '生きる価値がない',
  'この世から消えろ',

  // ── 違法行為を明確に助長する表現 ──
  '覚醒剤',
  '覚せい剤',
  'コカイン',
  'ヘロイン',
  '大麻',
  '違法薬物',
  '脱法ハーブ',
  '危険ドラッグ',
]

/**
 * ラテン文字の禁止語。すべて小文字で書くこと。
 *
 * こちらは部分一致では見ない。英単語は他の語の一部になりやすく、
 * "ass" は "bass"（スズキ）に、"cum" は "cumin"（クミン）に、
 * "rape" は "grape" に入ってしまう。前後が英数字でないときだけ当てる。
 *
 * 活用形は自動では広がらない（fuck と fucking は別に書く必要がある）。
 */
export const PROHIBITED_LATIN: readonly string[] = [
  'fuck',
  'fucking',
  'fucker',
  'motherfucker',
  'shit',
  'bullshit',
  'bitch',
  'cunt',
  'whore',
  'slut',
  'nigger',
  'nigga',
  'faggot',
  'rape',
  'rapist',
  'porn',
  'pornhub',
  'sex',
  'retard',
  'kys',
  'kill yourself',
]

/**
 * 判定用に文字をそろえる。
 *
 * これが無いと「ｆｕｃｋ」（全角）や「ﾌｪﾗﾁｵ」（半角カナ）で素通りする。
 *
 * ★ 空白や記号は取り除かない。
 *   「し ね」のような分かち書きを潰したくなるが、詰めてしまうと
 *   「美味いしね」が「死ね」に化ける。回避を1つ防ぐために
 *   普通の感想を弾くのは割に合わない。
 *
 * ★ SQL 側の lower(normalize(t, NFKC)) と結果を合わせること。
 */
export function normalizeForModeration(input: string): string {
  let s = input

  // Hermes に normalize が無い環境がありうるので、あるときだけ使う
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFKC')
  }

  // NFKC が使えなかったときの保険。全角の英数字だけは自前で寄せる
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  )

  return s.toLowerCase()
}

/** 正規表現の特殊文字を無効化する。語リストは手書きなので念のため。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 禁止語を含むか。
 *
 * 空文字・未入力は false（任意項目を空のまま保存できなくなるため）。
 */
export function containsProhibitedContent(text: string | null | undefined): boolean {
  if (!text) return false

  let t = normalizeForModeration(text)
  if (!t.trim()) return false

  // 無害な語を先に抜く。消さずに空白へ置き換えて、
  // 前後がくっついて別の語になるのを防ぐ。
  for (const safe of SAFE_PHRASES) {
    t = t.split(safe).join(' ')
  }

  for (const word of PROHIBITED_JA) {
    if (t.includes(word)) return true
  }

  for (const word of PROHIBITED_LATIN) {
    // 前後が英数字でないときだけ当てる（grape の rape を拾わないため）
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}($|[^a-z0-9])`)
    if (re.test(t)) return true
  }

  return false
}

/** 渡したもののどれか1つでも禁止語を含むか。画面側は項目をまとめて渡す。 */
export function anyProhibitedContent(
  ...texts: (string | null | undefined)[]
): boolean {
  return texts.some((t) => containsProhibitedContent(t))
}

/**
 * DB のトリガーが投げたエラーか。
 *
 * 端末側の判定をすり抜けても DB が最後に止める。そのときの
 * 素っ気ないエラーを、画面で同じ日本語に直すために使う。
 * メッセージで見ているのは、PostgREST が独自のエラーコードを
 * そのまま返さないため（lib/limits.ts の follow_limit_reached と同じ）。
 */
export function isProhibitedContentError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? ''
  return msg.includes('prohibited_content')
}
