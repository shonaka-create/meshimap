import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { supabase } from '../../src/lib/supabase'
import { PHOTO_CLEANUP_FAILED, useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { THEME_SETTINGS, useThemeSetting } from '../../src/hooks/useThemeSetting'
import { Txt } from '../../src/components/ui'
import { RankAvatar } from '../../src/components/RankAvatar'

const THEME_LABELS = { light: 'ライト', dark: 'ダーク', system: 'システム' } as const
const THEME_ICONS = {
  light: 'sunny-outline', dark: 'moon-outline', system: 'phone-portrait-outline',
} as const
const THEME_ORDER = ['light', 'dark', 'system'] as const

export default function Settings() {
  const { user, profile, signOut, deleteAccount, refreshProfile } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const { setting: themeSetting, setSetting: setThemeSetting } = useThemeSetting()
  const [savingPublic, setSavingPublic] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  /* ── 自分宛の承認待ちリクエスト数 ────────────────── */
  useFocusEffect(useCallback(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', user.id)
      .eq('status', 'pending')
      .then(({ count, error }) => {
        if (cancelled || error) return
        setPendingCount(count ?? 0)
      })
    return () => { cancelled = true }
  }, [user]))

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
        // 非公開→公開にすると、溜まっていた承認待ちは意味を失うので自動承認する。
        //
        // ★ ここの失敗を握りつぶさないこと。
        //   握りつぶすと「アカウントは公開になったのに、
        //   申請だけ承認待ちのまま残る」状態になり、
        //   公開したはずの相手にいつまでも見えない。
        const { error: acceptErr } = await supabase.from('follows')
          .update({ status: 'accepted' })
          .eq('following_id', user.id).eq('status', 'pending')

        if (acceptErr) {
          console.warn('[settings] 承認待ちの自動承認に失敗', acceptErr.message)
          Alert.alert(
            '公開に切り替えました',
            '承認待ちのフォローリクエストだけ、自動承認できませんでした。'
              + '\n「フォローリクエスト」から手で承認してください。',
            [{ text: '閉じる', style: 'cancel' }]
          )
        }
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
                    // 写真だけ消せなかった場合。
                    //
                    // ★ 勝手に進めないこと。ここで退会まで通すと、
                    //   その写真は公開バケットに残ったまま、
                    //   本人にも二度と消せなくなる（トークンが無効になる）。
                    //   かといって退会させないのも駄目なので、選んでもらう。
                    if ((e as Error).message === PHOTO_CLEANUP_FAILED) {
                      Alert.alert(
                        '写真を削除できませんでした',
                        '通信の状態が悪い可能性があります。'
                          + '\n電波の良いところでやり直すと、写真も一緒に削除できます。'
                          + '\n\nこのまま削除すると、アカウントと投稿は消えますが、'
                          + '写真のファイルだけがサーバーに残り、あとから消せなくなります。',
                        [
                          { text: 'やめる', style: 'cancel' },
                          {
                            text: '写真を残して削除',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await deleteAccount({ evenIfPhotosRemain: true })
                              } catch (e2) {
                                Alert.alert('削除に失敗しました', (e2 as Error).message)
                              }
                            },
                          },
                        ]
                      )
                      return
                    }
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

      {profile && (
        <Pressable
          onPress={() => router.push('/settings/edit-profile')}
          accessibilityRole="button"
          accessibilityLabel={`${profile.display_name}のプロフィールを編集`}
          style={({ pressed }) => [
            styles.row, styles.group,
            { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <RankAvatar
            uri={profile.photo_url}
            emoji={profile.avatar_emoji}
            name={profile.display_name}
            postsCount={profile.posts_count}
            areasCount={profile.areas_count}
            size={56}
          />
          <View style={{ flex: 1 }}>
            <Txt variant="heading">{profile.display_name}</Txt>
            <Txt variant="small" tone="faint">@{profile.username}</Txt>
            <Pressable
              onPress={() => router.push('/settings/edit-profile')}
              accessibilityRole="button"
              accessibilityLabel="プロフィールを編集"
              style={({ pressed }) => [styles.editButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name="create-outline" size={16} color={colors.textMuted} />
              <Txt variant="small" tone="muted">編集</Txt>
            </Pressable>
          </View>
        </Pressable>
      )}

      {/* ── 画面の見た目 ─────────────────────────
        * 端末の設定に従うのが既定。ただし「アプリ全体は明るいままで、
        * このアプリだけ暗くしたい」（逆も）という要望は普通にあるので、
        * ここで上書きできるようにしてある。
        * 設定はこの端末にだけ保存され、アカウントには紐づかない。
        */}
      <Section title="画面の見た目">
        <Group horizontal>
          {THEME_ORDER.map((value, index) => (
            <ThemeChoice
              key={value}
              label={THEME_LABELS[value]}
              accessibilityLabel={THEME_SETTINGS.find((t) => t.value === value)!.label}
              icon={THEME_ICONS[value]}
              divider={index > 0}
              selected={themeSetting === value}
              onPress={() => setThemeSetting(value)}
            />
          ))}
        </Group>
        <Txt variant="small" tone="faint" numberOfLines={1}>
          {THEME_SETTINGS.find((t) => t.value === themeSetting)?.note}
        </Txt>
      </Section>

      {/* ── プライバシー ─────────────────────────── */}
      <Section title="">
        <View style={[styles.row, styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
        <Group>
          <Item
            icon="person-outline"
            label="プロフィールを編集"
            sub={profile ? `${profile.display_name} · @${profile.username}` : undefined}
            onPress={() => router.push('/settings/edit-profile')}
          />
          <Item
            divider
            notification={pendingCount > 0}
            icon="person-add-outline"
            label="フォローリクエスト"
            // 件数はここにしか出ない。旧「フォロー」タブの上部に出していた
            // 案内を、タブを畳んだときにこちらへ寄せた。
            sub={pendingCount > 0 ? `${pendingCount}件の承認待ち` : undefined}
            onPress={() => router.push('/settings/requests')}
          />
          <Item
            divider
            icon="ban-outline"
            label="ブロックしたアカウント"
            onPress={() => router.push('/settings/blocked')}
          />
        </Group>
      </Section>

      {/* ── 規約 ─────────────────────────────── */}
      <Section title="このアプリについて">
        <Group>
          <Item icon="document-text-outline" label="利用規約" onPress={() => router.push('/legal/terms')} />
          <Item divider icon="shield-checkmark-outline" label="プライバシーポリシー" onPress={() => router.push('/legal/privacy')} />
        </Group>
      </Section>

      {/* ── 危険な操作 ───────────────────────────── */}
      <Group>
        <Item icon="log-out-outline" label="ログアウト" onPress={signOut} />
        <Item divider icon="trash-outline" label="アカウントを削除" danger onPress={confirmDelete} />
      </Group>

      <Txt variant="small" tone="faint" style={{ textAlign: 'center' }}>
        MeshiMap{Constants.expoConfig?.version ? ` v${Constants.expoConfig.version}` : ''}
      </Txt>
    </ScrollView>
  )
}

/**
 * 見た目の選択肢1つぶん。
 *
 * 押した結果がその場で画面全体に出るので、選択の印は
 * 控えめでよい（色が変われば選べたことは分かる）。
 */
function ThemeChoice({
  label, accessibilityLabel, icon, divider, selected, onPress,
}: {
  label: string
  accessibilityLabel: string
  icon: keyof typeof Ionicons.glyphMap
  divider: boolean
  selected: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.themeChoice,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surface,
          borderColor: colors.border,
          borderLeftWidth: divider ? StyleSheet.hairlineWidth : 0,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={selected ? colors.accent : colors.textMuted}
      />
      <Txt variant="small" tone={selected ? 'accent' : 'muted'}>{label}</Txt>
    </Pressable>
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

function Group({ children, horizontal = false }: { children: React.ReactNode; horizontal?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={[
      styles.group,
      { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: horizontal ? 'row' : 'column' },
    ]}>
      {children}
    </View>
  )
}

function Item({
  icon, label, sub, onPress, danger, divider = false, notification = false,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  sub?: string
  onPress: () => void
  danger?: boolean
  divider?: boolean
  notification?: boolean
}) {
  const { colors } = useTheme()
  const tint = danger ? colors.danger : colors.text

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <View style={{ flex: 1 }}>
        <Txt variant="body" style={{ color: tint }}>{label}</Txt>
        {!!sub && <Txt variant="small" tone="faint">{sub}</Txt>}
      </View>
      {notification && <View style={[styles.notification, { backgroundColor: colors.danger }]} />}
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  group: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  themeChoice: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.md,
  },
  editButton: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  notification: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
})
