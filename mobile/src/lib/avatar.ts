import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from './supabase'

/**
 * プロフィール写真（アイコン）の入れ替え。
 *
 * 同じ処理がプロフィール編集画面とプロフィール画面の2箇所から要る。
 * 片方だけ直すと、どちらから変えたかで挙動が違うことになるので、
 * 選ぶ・上げる・前のを消す、の3つをここに集める。
 *
 * ★ Storage のパスは `${uid}/...` で始めること。
 *   移行 0014 で、先頭フォルダ = 自分のUID でないと
 *   置くことも消すこともできないようにしてある。
 */

/** アイコンの一辺(px)。小さく出す画像なので大きく持つ理由が無い */
const AVATAR_EDGE = 512

/** 公開URLからオブジェクトのパスを取り出すための目印 */
const PUBLIC_MARKER = '/object/public/avatars/'

/**
 * 写真を1枚選ばせる。
 *
 * @returns 選ばれた画像の URI。断られた・やめた場合は null
 * @throws 権限が無い場合。呼び出し側が案内を出す
 */
export async function pickAvatarImage(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) {
    throw new Error('PHOTO_PERMISSION_DENIED')
  }

  const res = await ImagePicker.launchImageLibraryAsync({
    // 動画は選ばせない。アイコンに動画は使えない
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  })

  if (res.canceled) return null

  // ★ assets が空で返る場合がある。
  //   canceled が false でも、端末やOSの状態によっては
  //   選ばれた項目を1件も返さないことがある。
  //   res.assets[0].uri と直接書くと、そこで TypeError になり
  //   アイコンを変えようとしただけで画面が落ちる。
  //   「やめた」と同じ扱いにして静かに戻る。
  const uri = res.assets?.[0]?.uri
  return uri ? uri : null
}

/**
 * 選んだ画像を縮めて Storage に上げ、公開URLを返す。
 *
 * ★ 正方形に切ったあとなので、幅だけ指定すれば足りる
 *   （投稿写真と違って縦横比が固定されている）。
 */
export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  const m = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: AVATAR_EDGE } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  )

  const res = await fetch(m.uri)
  const bytes = await res.arrayBuffer()

  // 毎回新しい名前にする。同じ名前だと、端末やCDNが前の画像を
  // 掴んだままになって「変えたのに変わらない」が起きる
  const path = `${userId}/avatar_${Date.now()}.jpg`

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error

  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

/**
 * 置き換えた前のアイコンを消す。
 *
 * ★ 新しい方の保存が通ってから呼ぶこと。
 *   先に消すと、保存に失敗したときにアイコンだけ消える。
 *
 * ★ 自分のフォルダ配下でなければ触らない。
 *   Storage のポリシー（0014）でも弾かれるが、
 *   他人のURLが入っていたときに消しにいかないよう、ここでも見る。
 *
 * 消せなくても呼び出し側の処理は成功しているので、
 * ログだけ残して黙って進む。
 */
export async function deleteAvatarByUrl(userId: string, publicUrl: string): Promise<void> {
  try {
    const at = publicUrl.indexOf(PUBLIC_MARKER)
    if (at < 0) return

    const path = decodeURIComponent(publicUrl.slice(at + PUBLIC_MARKER.length).split('?')[0])
    if (!path.startsWith(`${userId}/`)) return

    const { error } = await supabase.storage.from('avatars').remove([path])
    if (error) console.warn('[avatar] 前のアイコンを消せませんでした', error.message)
  } catch (e) {
    console.warn('[avatar] 前のアイコンの後片付けに失敗', e)
  }
}

/** pickAvatarImage が投げた「写真の権限が無い」エラーか */
export function isPhotoPermissionError(e: unknown): boolean {
  return (e as Error)?.message === 'PHOTO_PERMISSION_DENIED'
}
