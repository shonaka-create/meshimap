import { useCallback, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { PHOTO_CLEANUP_FAILED, useAuth } from '../../src/hooks/useAuth'
import { useTheme, space, radius } from '../../src/theme'
import { THEME_SETTINGS, useThemeSetting } from '../../src/hooks/useThemeSetting'
import { Txt } from '../../src/components/ui'

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

      {/* ── 画面の見た目 ─────────────────────────
        * 端末の設定に従うのが既定。ただし「アプリ全体は明るいままで、
        * このアプリだけ暗くしたい」（逆も）という要望は普通にあるので、
        * ここで上書きできるようにしてある。
        * 設定はこの端末にだけ保存され、アカウントには紐づかない。
        */}
      <Section title="画面の見た目">
        <View style={{ gap: space.sm }}>
          {THEME_SETTINGS.map((t) => (
            <ThemeChoice
              key={t.value}
              label={t.label}
              note={t.note}
              selected={themeSetting === t.value}
              onPress={() => setThemeSetting(t.value)}
            />
          ))}
        </View>
      </Section>

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
          // 件数はここにしか出ない。旧「フォロー」タブの上部に出していた
          // 案内を、タブを畳んだときにこちらへ寄せた。
          sub={pendingCount > 0 ? `${pendingCount}件の承認待ち` : undefined}
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

/**
 * 見た目の選択肢1つぶん。
 *
 * 押した結果がその場で画面全体に出るので、選択の印は
 * 控えめでよい（色が変われば選べたことは分かる）。
 */
function ThemeChoice({
  label, note, selected, onPress,
}: { label: string; note: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme()

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? colors.accent : colors.textFaint}
      />
      <View style={{ flex: 1 }}>
        <Txt variant="body">{label}</Txt>
        <Txt variant="small" tone="faint">{note}</Txt>
      </View>
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
