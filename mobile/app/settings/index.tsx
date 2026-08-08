import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { Txt } from '../../src/components/ui'

export default function Settings() {
  const { user, profile, signOut, deleteAccount, refreshProfile } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const [savingPublic, setSavingPublic] = useState(false)

  /* ── アカウントの公開/非公開 ────────────────────── */
  const togglePublic = useCallback(async (next: boolean) => {
    if (!user) return
    setSavingPublic(true)

    const { error } = await supabase.from('profiles').update({ is_public: next }).eq('id', user.id)
    if (error) {
      Alert.alert('変更に失敗しました', error.message)
    } else {
      await refreshProfile()
      if (next) {
        // 非公開→公開にすると、溜まっていた承認待ちは意味を失うので自動承認する
        await supabase.from('follows').update({ status: 'accepted' })
          .eq('following_id', user.id).eq('status', 'pending')
      }
    }
    setSavingPublic(false)
  }, [user, refreshProfile])

  /* ── アカウント削除（App Store Guideline 5.1.1(v) 必須） ── */
  const confirmDelete = useCallback(() => {
    Alert.alert(
      'アカウントを削除しますか？',
      '投稿・写真・フォロー関係を含むすべてのデータが削除されます。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: () =>
            Alert.alert('本当に削除しますか？', 'この操作は取り消せません。', [
              { text: 'やめる', style: 'cancel' },
              {
                text: '完全に削除',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteAccount()
                  } catch (e) {
                    Alert.alert('削除に失敗しました', (e as Error).message)
                  }
                },
              },
            ]),
        },
      ]
    )
  }, [deleteAccount])

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.xl }}>

      {/* ── プライバシー ─────────────────────────── */}
      <Section title="プライバシー">
        <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons
            name={profile?.is_public ? 'earth' : 'lock-closed'}
            size={20}
            color={profile?.is_public ? colors.geo : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyMed">アカウントを公開する</Txt>
            <Txt variant="small" tone="muted">
              {profile?.is_public
                ? '公開中。あなたの「公開した投稿」が検索や地図に表示されます。'
                : '非公開。承認したフォロワーだけが公開投稿を見られます。'}
            </Txt>
          </View>
          <Switch
            value={!!profile?.is_public}
            onValueChange={togglePublic}
            disabled={savingPublic}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
          />
        </View>

        <Txt variant="small" tone="faint">
          投稿ごとの公開/非公開は、プロフィールの写真にある鍵アイコンから切り替えます。
          投稿は作成時は必ず非公開です。
        </Txt>
      </Section>

      {/* ── アカウント ───────────────────────────── */}
      <Section title="アカウント">
        <Item
          icon="person-outline"
          label="プロフィールを編集"
          sub={profile ? `${profile.display_name} · @${profile.username}` : undefined}
          onPress={() => router.push('/settings/edit-profile')}
        />
        <Item
          icon="person-add-outline"
          label="フォローリクエスト"
          onPress={() => router.push('/settings/requests')}
        />
        <Item
          icon="ban-outline"
          label="ブロックしたアカウント"
          onPress={() => router.push('/settings/blocked')}
        />
      </Section>

      {/* ── 規約 ─────────────────────────────── */}
      <Section title="このアプリについて">
        <Item icon="document-text-outline" label="利用規約" onPress={() => router.push('/legal/terms')} />
        <Item icon="shield-checkmark-outline" label="プライバシーポリシー" onPress={() => router.push('/legal/privacy')} />
      </Section>

      {/* ── 危険な操作 ───────────────────────────── */}
      <Section title="">
        <Item icon="log-out-outline" label="ログアウト" onPress={signOut} />
        <Item icon="trash-outline" label="アカウントを削除" danger onPress={confirmDelete} />
      </Section>

      <Txt variant="small" tone="faint" style={{ textAlign: 'center' }}>
        MeshiMap v1.0.0
      </Txt>
    </ScrollView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {!!title && <Txt variant="caption" tone="faint">{title.toUpperCase()}</Txt>}
      <View style={{ gap: space.sm }}>{children}</View>
    </View>
  )
}

function Item({
  icon, label, sub, onPress, danger,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  sub?: string
  onPress: () => void
  danger?: boolean
}) {
  const { colors } = useTheme()
  const tint = danger ? colors.danger : colors.text

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ color: tint }}>{label}</Txt>
        {!!sub && <Txt variant="small" tone="faint">{sub}</Txt>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
})
