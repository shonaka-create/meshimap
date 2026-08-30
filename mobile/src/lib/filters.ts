/**
 * PostgREST のフィルタ文字列を組み立てるための道具。
 *
 * ★ 値をそのまま文字列に埋めないこと。
 *
 *   `.or()` に渡す文字列は PostgREST が読む式であって、
 *   ただの文字列ではない。`,` は条件の区切り、`.` は
 *   「列.演算子.値」の区切り、`()` は条件のまとまりを表す。
 *
 *   検索欄に「新宿, 焼肉」と打たれると
 *     display_name.ilike.%新宿, 焼肉%,username.ilike.%新宿, 焼肉%
 *   が 4 条件として読まれ、`焼肉%` は列名として解釈できないので
 *   400 が返る。画面には「見つかりませんでした」としか出ないため、
 *   検索が壊れていることに誰も気付けない。
 *
 *   さらに、検索欄から条件を1つ足せてしまう
 *   （`x%,is_public.eq.false,caption.ilike.%y` のような入力）。
 *   RLS があるので見えてはいけないものは見えないが、
 *   打った語と実際に検索される語が食い違うのは誤りなので塞ぐ。
 *
 * PostgREST は値を二重引用符で囲むと、中の予約文字を
 * ただの文字として扱う。中の `"` と `\` だけは `\` で逃がす。
 * https://docs.postgrest.org/en/v13/references/api/url_grammar.html
 */

/**
 * フィルタの「値」を、予約文字を含んでいても壊れない形にする。
 *
 * @example
 *   `location_name.ilike.${pgValue('%新宿, 焼肉%')}`
 *   → location_name.ilike."%新宿, 焼肉%"
 */
export function pgValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 部分一致（ilike）の値。前後に % を付けたうえで引用する。
 *
 * ★ 利用者が打った `%` `_` `*` はそのまま渡している。
 *   これらは LIKE のワイルドカードとして働くが、
 *   「打った文字が消える」より「広く当たる」ほうが
 *   検索としては素直なので、潰していない。
 */
export function pgContains(value: string): string {
  return pgValue(`%${value}%`)
}
