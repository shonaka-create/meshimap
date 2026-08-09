import { useCallback, useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useTheme, space, radius } from '../../src/theme'
import { Button, Loading, Txt } from '../../src/components/ui'
import { FREE_FOLLOW_LIMIT, type FollowQuota } from '../../src/lib/limits'
import {
  BENEFITS, BillingNotReadyError, DEFAULT_PLAN_ID, MANAGE_SUBSCRIPTION_URL,
  PLANS, planOf, purchase, restore, type Plan,
} from '../../src/lib/billing'

/**
 * プラン画面。
 *
 * 買う画面は、機能の一覧ではなく「いま何ができていないか」から始める。
 * フォロー枠が埋まっている人に無制限を売るのと、
 * まだ1人もフォローしていない人に売るのとでは、
 * 同じ文でも意味が違う。最初に現状を出してから中身を出す。
 *
 * ★ 決済はまだ繋がっていない（src/lib/billing.ts）。
 *   購入処理だけを後から差し替えられるようにしてある。
 *
 * ★ Apple の審査で要るものは先に入れてある:
 *   価格・期間・自動更新の明示 / 購入の復元 / 利用規約とプライバシーポリシー
 *   / 解約は OS の設定から行うという案内（Guideline 3.1.1, 3.1.2）。
 *   後から足そうとすると、だいたいリジェクトされてから気づく。
 */
export default function Subscription() {
  const { colors } = useTheme()
  const router = useRouter()

  const [quota, setQuota] = useState<FollowQuota | null>(null)
  const [selected, setSelected] = useState<Plan['id']>(DEFAULT_PLAN_ID)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_follow_quota')
    if (error) {
      console.warn('[subscription] 取得に失敗', error.message)
      return
    }
    // RPC は1行のテーブルを返す
    setQuota((Array.isArray(data) ? data[0] : data) as FollowQuota)
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const notReady = () =>
    Alert.alert(
      'まだお支払いに進めません',
      'App内課金の準備が終わり次第、この画面から購入できるようになります。'
        + '\nいましばらくお待ちください。'
    )

  const onPurchase = useCallback(async () => {
    setBusy(true)
    try {
      await purchase(selected)
      // 解放は Webhook が subscriptions を更新して初めて成立する。
      // 「買えた」と「解放された」は別物なので、状態は取り直す。
      await load()
    } catch (e) {
      if (e instanceof BillingNotReadyError) notReady()
      else Alert.alert('購入できませんでした', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [selected, load])

  const onRestore = useCallback(async () => {
    setBusy(true)
    try {
      await restore()
      await load()
    } catch (e) {
      if (e instanceof BillingNotReadyError) notReady()
      else Alert.alert('復元できませんでした', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [load])

  if (!quota) {
    return (
      <>
        <Stack.Screen options={{ title: 'プラン' }} />
        <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>
      </>
    )
  }

  /* ── 契約中の人には、売り込みではなく管理の画面を出す ───── */
  if (quota.subscribed) {
    return (
      <>
        <Stack.Screen options={{ title: 'プラン' }} />
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.bg }}
          contentContainerStyle={styles.body}
        >
          <View style={[styles.hero, { borderColor: colors.border }]}>
            <Txt variant="caption" tone="faint" style={styles.eyebrow}>YOUR PLAN</Txt>
            <Txt variant="title">プレミアム</Txt>
            <Txt variant="small" tone="muted">
              フォロー {quota.used}人（上限なし）
            </Txt>
          </View>

          <View style={styles.section}>
            <Txt variant="heading">使えるもの</Txt>
            {BENEFITS.map((b) => (
              <BenefitRow key={b.title} {...b} />
            ))}
          </View>

          <Pressable
            onPress={() => Linking.openURL(MANAGE_SUBSCRIPTION_URL)}
            style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Txt variant="smallMed" tone="accent">お支払いと解約の管理</Txt>
            <Ionicons name="open-outline" size={15} color={colors.accent} />
          </Pressable>
          <Txt variant="caption" tone="faint">
            解約は端末の設定（App Store のアカウント）から行います。
            このアプリからは操作できません。
          </Txt>
        </ScrollView>
      </>
    )
  }

  /* ── 未契約 ───────────────────────────────── */
  const plan = planOf(selected)
  const full = quota.used >= quota.limit_count

  return (
    <>
      <Stack.Screen options={{ title: 'プラン' }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={styles.body}
      >
        {/* いまの状態から始める。何ができていないかが動機になる */}
        <View style={[styles.hero, { borderColor: colors.border }]}>
          <Txt variant="caption" tone="faint" style={styles.eyebrow}>MESHIMAP PREMIUM</Txt>
          <Txt variant="title">
            {full ? 'フォロー枠が埋まりました' : '他の人の地図を、もっと'}
          </Txt>
          <View style={styles.quotaRow}>
            <Ionicons name="people-outline" size={15} color={colors.textMuted} />
            <Txt variant="small" tone="muted">
              フォロー {quota.used} / {quota.limit_count}人
            </Txt>
          </View>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(quota.used / Math.max(quota.limit_count, 1), 1) * 100}%`,
                  backgroundColor: full ? colors.danger : colors.accent,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.section}>
          {BENEFITS.map((b) => (
            <BenefitRow key={b.title} {...b} />
          ))}
        </View>

        {/* ── プランの選択 ─────────────────────────
          * 年額を既定にしておく。並べて選ばせるとき、
          * 何も選ばれていない状態から始めると離脱が増える。
          */}
        <View style={styles.plans}>
          {PLANS.map((p) => {
            const on = p.id === selected
            return (
              <Pressable
                key={p.id}
                onPress={() => setSelected(p.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [
                  styles.plan,
                  {
                    borderColor: on ? colors.text : colors.border,
                    borderWidth: on ? 2 : 1,
                    backgroundColor: on ? colors.surface : colors.bg,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {p.savingPercent != null && (
                  <View style={[styles.saving, { backgroundColor: colors.accent }]}>
                    <Txt variant="caption" style={{ color: colors.accentText }}>
                      {p.savingPercent}%お得
                    </Txt>
                  </View>
                )}
                <Txt variant="smallMed" tone="muted">{p.name}</Txt>
                <Txt variant="title">{p.priceLabel}</Txt>
                <Txt variant="caption" tone="faint">{p.perMonthLabel}</Txt>
              </Pressable>
            )
          })}
        </View>

        <Button
          title={`${plan.name}ではじめる`}
          loading={busy}
          onPress={onPurchase}
        />

        {/* ★ 自動更新の条件は買う前に見えていないといけない。
              「あとで規約を読めば分かる」はリジェクトの理由になる。 */}
        <Txt variant="caption" tone="faint" style={styles.terms}>
          {plan.priceLabel} / {plan.period}の自動更新です。
          解約しない限り、期間の終了24時間前までに同額で更新されます。
          解約は端末の設定（App Store のアカウント）からいつでも行えます。
        </Txt>

        <View style={styles.foot}>
          {/* ★ 購入の復元は Apple の必須要件。機種変更や再インストールで
                買い直しを強いる作りは審査を通らない。 */}
          <Pressable onPress={onRestore} hitSlop={8} disabled={busy}>
            <Txt variant="smallMed" tone="accent">購入を復元</Txt>
          </Pressable>
          <Pressable onPress={() => router.push('/legal/terms')} hitSlop={8}>
            <Txt variant="smallMed" tone="muted">利用規約</Txt>
          </Pressable>
          <Pressable onPress={() => router.push('/legal/privacy')} hitSlop={8}>
            <Txt variant="smallMed" tone="muted">プライバシー</Txt>
          </Pressable>
        </View>

        <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Txt variant="small" tone="muted" style={{ flex: 1 }}>
            運営アカウントはフォローの人数に含まれません。
            無料のままでも、行った店を地図に残す機能はすべて使えます
            （フォローは{FREE_FOLLOW_LIMIT}人まで）。
          </Txt>
        </View>
      </ScrollView>
    </>
  )
}

function BenefitRow({ icon, title, body }: { icon: string; title: string; body: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon as never} size={20} color={colors.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyMed">{title}</Txt>
        <Txt variant="small" tone="muted">{body}</Txt>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.xl, paddingBottom: space.xxxl },
  eyebrow: { letterSpacing: 2 },
  hero: {
    gap: space.xs,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
  },
  quotaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  track: { height: 4, overflow: 'hidden', marginTop: space.xs },
  fill: { height: '100%' },
  section: { gap: space.lg },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  plans: { flexDirection: 'row', gap: space.sm },
  plan: {
    flex: 1,
    padding: space.md,
    borderRadius: radius.md,
    gap: 2,
    minHeight: 104,
    justifyContent: 'center',
  },
  saving: {
    position: 'absolute', top: -9, right: space.sm,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm,
  },
  terms: { lineHeight: 18 },
  foot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
})
