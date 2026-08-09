import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuth, validateUsername } from '../../src/hooks/useAuth'
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
      const free = await isUsernameAvailable(username)
      if (mine !== seq.current) return
      setUsernameTaken(!free)
      setChecking(false)
    }, 450)
    return () => clearTimeout(t)
  }, [username, usernameChanged, usernameError, isUsernameAvailable])

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('写真へのアクセスが必要です', '設定アプリから写真の許可を有効にしてください。')
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    })
    if (res.canceled) return
    setNewPhoto(res.assets[0].uri)
    setPhotoUri(res.assets[0].uri)
  }

  const save = async () => {
    if (!user || !profile) return
    if (!displayName.trim()) { Alert.alert('アカウント名を入力してください'); return }
    if (usernameError) { Alert.alert(usernameError); return }
    if (usernameTaken) { Alert.alert('このユーザーIDは既に使われています'); return }

    setSaving(true)
    try {
      let photoUrl = profile.photo_url

      if (newPhoto) {
        const m = await ImageManipulator.manipulateAsync(
          newPhoto,
          [{ resize: { width: 512 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
        )
        const res = await fetch(m.uri)
        const bytes = await res.arrayBuffer()

        // Storage ポリシーが先頭フォルダ = 自分のUID を要求する
        const path = `${user.id}/avatar_${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
        if (upErr) throw upErr

        photoUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      }

      const { error } = await supabase.from('profiles').update({
        display_name: displayName.trim(),
        username,
        bio: bio.trim(),
        photo_url: photoUrl,
      }).eq('id', user.id)

      if (error) throw error

      await refreshProfile()
      router.back()
    } catch (e) {
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
