import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import {
  deleteAvatarByUrl, isPhotoPermissionError, pickAvatarImage, uploadAvatar,
} from '../../src/lib/avatar'
import { useAuth, validateUsername } from '../../src/hooks/useAuth'
import {
  anyProhibitedContent, isProhibitedContentError, PROHIBITED_CONTENT_MESSAGE,
} from '../../src/lib/moderation'
import { useTheme, space } from '../../src/theme'
import { Avatar, Button, Field, Txt } from '../../src/components/ui'

export default function EditProfile() {
  const { user, profile, refreshProfile, isUsernameAvailable } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [newPhoto, setNewPhoto] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [usernameTaken, setUsernameTaken] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.display_name)
    setUsername(profile.username)
    setBio(profile.bio ?? '')
    setPhotoUri(profile.photo_url)
  }, [profile])

  const usernameError = username ? validateUsername(username) : null
  const usernameChanged = !!profile && username !== profile.username

  // ユーザーIDを変えたときだけ空き確認する
  const seq = useRef(0)
  useEffect(() => {
    // ★ ここで checking を落とさないと、保存ボタンが二度と押せなくなる。
    //   ユーザーIDを触ってから元の値に戻すと usernameChanged が false になり
    //   この早期 return に入るが、直前に立てた checking が true のまま残るため、
    //   disabled={... || checking} が永久に真になっていた。
    if (!usernameChanged || usernameError) {
      setUsernameTaken(false)
      setChecking(false)
      return
    }
    setChecking(true)
    const mine = ++seq.current
    const t = setTimeout(async () => {
      const result = await isUsernameAvailable(username)
      if (mine !== seq.current) return
      // ★ 確かめられなかった（'unknown'）を「使われている」にしないこと。
      //   圏外で開いただけで保存ボタンが押せなくなる。
      //   空いていなければ保存時に UNIQUE 制約が弾き、同じ文言が出る。
      setUsernameTaken(result === 'taken')
      setChecking(false)
    }, 450)
    return () => clearTimeout(t)
  }, [username, usernameChanged, usernameError, isUsernameAvailable])

  const pickPhoto = async () => {
    try {
      const uri = await pickAvatarImage()
      if (!uri) return
      // ここでは上げない。保存を押したときにまとめて上げる
      setNewPhoto(uri)
      setPhotoUri(uri)
    } catch (e) {
      if (isPhotoPermissionError(e)) {
        Alert.alert('写真へのアクセスが必要です', '設定アプリから写真の許可を有効にしてください。')
        return
      }
      Alert.alert('写真を選べませんでした', (e as Error).message)
    }
  }

  const save = async () => {
    if (!user || !profile) return
    if (!displayName.trim()) { Alert.alert('アカウント名を入力してください'); return }
    if (usernameError) { Alert.alert(usernameError); return }
    if (usernameTaken) { Alert.alert('このユーザーIDは既に使われています'); return }

    /* ── 不適切な表現の確認（Guideline 1.2）─────────────────
     * 表示名と自己紹介は、投稿しなくても他の人から見える。
     * ★ 写真を上げる前に見る。順番を変えると、保存できなかった
     *   アイコン画像だけが Storage に残る。
     * ユーザーIDは小文字英字3〜20文字の制約で別に守られているため、
     * ここでは見ない（既存仕様のまま）。 */
    if (anyProhibitedContent(displayName, bio)) {
      Alert.alert('保存できません', PROHIBITED_CONTENT_MESSAGE)
      return
    }

    setSaving(true)
    // 上げたのに保存が通らなかった画像。片付ける対象
    let orphan: string | null = null

    try {
      let photoUrl = profile.photo_url

      if (newPhoto) {
        photoUrl = await uploadAvatar(user.id, newPhoto)
        orphan = photoUrl
      }

      const { error } = await supabase.from('profiles').update({
        display_name: displayName.trim(),
        username,
        bio: bio.trim(),
        photo_url: photoUrl,
      }).eq('id', user.id)

      if (error) throw error

      // ★ 保存が通ってから、置き換えた前のアイコンを消す。
      //   パスは毎回 avatar_${Date.now()}.jpg で新しくなるので、
      //   消さないと変えるたびに古い画像が Storage に溜まる。
      //   avatars は public バケットなので、URL を知っていれば
      //   前のアイコンがいつまでも開ける。
      //   先に消すと、保存に失敗したときにアイコンだけ消える。
      if (newPhoto && profile.photo_url && profile.photo_url !== photoUrl) {
        await deleteAvatarByUrl(user.id, profile.photo_url)
      }
      orphan = null   // 保存が通ったので、これはもう孤児ではない

      await refreshProfile()
      router.back()
    } catch (e) {
      // ★ 上げたのに使わなかった画像は片付ける。
      //   置いたままにすると、public バケットに誰からも参照されない
      //   写真が溜まっていく。
      if (orphan) await deleteAvatarByUrl(user.id, orphan)

      // DBのトリガーに止められた場合は、端末側で弾いたときと同じ文言を出す
      if (isProhibitedContentError(e)) {
        Alert.alert('保存できません', PROHIBITED_CONTENT_MESSAGE)
        return
      }
      const msg = (e as Error).message
      Alert.alert(
        '保存に失敗しました',
        msg.includes('profiles_username_key')
          ? 'このユーザーIDは既に使われています'
          : msg.includes('profiles_username_format')
            ? 'ユーザーIDは小文字のアルファベット3〜20文字にしてください'
            : msg
      )
    } finally {
      setSaving(false)
    }
  }

  if (!profile) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }}><ActivityIndicator style={{ marginTop: space.xxl }} /></View>
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>

        <View style={{ alignItems: 'center', gap: space.sm }}>
          <Pressable onPress={pickPhoto} accessibilityLabel="プロフィール写真を変更">
            <Avatar uri={photoUri} name={displayName} size={104} />
            <View style={[styles.camera, { backgroundColor: colors.accent, borderColor: colors.bg }]}>
              <Ionicons name="camera" size={16} color={colors.accentText} />
            </View>
          </Pressable>
          <Pressable onPress={pickPhoto} hitSlop={8}>
            <Txt variant="smallMed" tone="accent">写真を変更</Txt>
          </Pressable>
        </View>

        <Field
          label="アカウント名（表示名）"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={30}
          hint="アプリ上で表示される名前です。他の人と同じでも構いません。"
        />

        <Field
          label="ユーザーID"
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z]/g, ''))}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          prefix="@"
          right={
            !usernameChanged ? undefined
            : checking ? <ActivityIndicator size="small" color={colors.textFaint} />
            : usernameTaken ? <Ionicons name="close-circle" size={20} color={colors.danger} />
            : <Ionicons name="checkmark-circle" size={20} color={colors.geo} />
          }
          error={usernameError ?? (usernameTaken ? 'このユーザーIDは既に使われています' : null)}
          hint="小文字のアルファベットのみ・3〜20文字。全体で重複しません。"
        />

        <Field
          label="自己紹介"
          value={bio}
          onChangeText={setBio}
          placeholder="好きな food や行きつけのお店など"
          multiline
          maxLength={200}
          style={{ minHeight: 88, textAlignVertical: 'top' }}
          hint={`${bio.length} / 200`}
        />

        <Button
          title="保存する"
          onPress={save}
          loading={saving}
          disabled={!displayName.trim() || !!usernameError || usernameTaken || checking}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  camera: {
    position: 'absolute', bottom: 0, right: 0,
    width: 32, height: 32, borderRadius: 16, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
  },
})
