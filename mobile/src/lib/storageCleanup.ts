import { supabase } from './supabase'

/**
 * 自分がアップロードした写真の実体を消す。
 *
 * ★ なぜ要るか
 *   delete_my_account()（移行 0001）は auth.users を消すだけで、
 *   profiles / posts / post_images は ON DELETE CASCADE で連鎖して消える。
 *   しかし Storage のオブジェクトはDBの外にあるので、消えない。
 *   post-images と avatars はどちらも public バケットなので、
 *   URL を控えていれば退会後もその写真が開ける。
 *
 *   設定画面は「投稿・写真を含むすべてのデータが削除されます」と
 *   言っている。言ったとおりにならないのは、
 *   Guideline 5.1.1(v)（アカウント削除）としても具合が悪い。
 *
 * ★ 消す順番
 *   必ず delete_my_account() より先に呼ぶこと。
 *   先にアカウントを消すとトークンが無効になり、
 *   Storage のポリシー（先頭フォルダ = 自分のUID）で弾かれて
 *   二度と消せなくなる。
 *
 * ★ 失敗を黙って飲み込まないこと
 *   ここで失敗したまま退会まで進めると、写真は公開バケットに
 *   残るのに、トークンが無効になって二度と消せなくなる。
 *   「写真を含むすべてのデータが削除されます」と言った以上、
 *   消せなかったことは呼び出し元に伝える。
 *   そのうえで退会を進めるかどうかは、本人に選んでもらう
 *   （消せないから退会できない、では 5.1.1(v) を満たさない）。
 */

/** list() は既定 100 件なので明示する。1回で取り切れなければ続きを取る */
const PAGE = 1000

/** 1階層ぶんの中身を全部返す（ファイルもフォルダも混ざる） */
async function listAll(bucket: string, prefix: string) {
  const out: { name: string; id: string | null }[] = []

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset })

    if (error) throw error
    if (!data || data.length === 0) break

    out.push(...data.map((e) => ({ name: e.name, id: e.id ?? null })))
    if (data.length < PAGE) break
  }

  return out
}

/**
 * フォルダの下にあるファイルのパスを、階層をすべて辿って集める。
 *
 * Supabase の list は、そのフォルダ直下しか返さない。
 * フォルダかどうかは id が null かどうかで見分ける
 * （Storage は本物のフォルダを持たず、名前の区切りで見せている）。
 *
 * ★ 段数を決め打ちしないこと。
 *   アプリが作るのは `uid/postId/0.jpg`（2段）と
 *   `uid/avatar_*.jpg`（1段）だけだが、移行 0014 より前は
 *   Storage の INSERT ポリシーが置き場所を見ていなかったので、
 *   もっと深いパスのオブジェクトが残っている可能性がある。
 *   「2段だけ辿る」と、それが消し残る。
 */
const MAX_DEPTH = 8

async function collectFiles(
  bucket: string,
  prefix: string,
  depth = 0
): Promise<string[]> {
  // ★ 打ち切りは「消せなかった」であって「無かった」ではない。
  //   ここで空配列を返すと、呼び出し元は消し終えたと思って
  //   退会まで進み、その写真は誰にも消せない公開ファイルとして残る。
  //   投げて、失敗として扱わせる。
  if (depth >= MAX_DEPTH) {
    throw new Error(`${bucket}/${prefix} が深すぎて辿りきれませんでした`)
  }

  const paths: string[] = []

  for (const entry of await listAll(bucket, prefix)) {
    const full = `${prefix}/${entry.name}`
    if (entry.id !== null) paths.push(full)
    else paths.push(...(await collectFiles(bucket, full, depth + 1)))
  }

  return paths
}

/** 自分のフォルダの下にあるものを全部消す */
async function purgeFolder(bucket: string, userId: string): Promise<number> {
  const paths = await collectFiles(bucket, userId)
  if (paths.length === 0) return 0

  // remove は一度に渡せる数に上限があるので分けて出す
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(paths.slice(i, i + 100))
    if (error) throw error
  }

  return paths.length
}

/**
 * 退会前の後始末。
 *
 * @returns 消したファイル数と、消せなかったバケット名
 */
export async function removeMyStorageFiles(
  userId: string
): Promise<{ removed: number; failed: string[] }> {
  let removed = 0
  const failed: string[] = []

  for (const bucket of ['post-images', 'avatars']) {
    try {
      removed += await purgeFolder(bucket, userId)
    } catch (e) {
      console.warn(`[storage] ${bucket} の後片付けに失敗`, e)
      failed.push(bucket)
    }
  }

  return { removed, failed }
}
