import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useTheme, space, radius } from '../theme'
import { Button, Field, Txt } from './ui'
import { REPORT_REASONS, type ReportReason } from '../lib/types'

/**
 * 通報ダイアログ。
 * App Store Review Guideline 1.2 は UGC アプリに
 * 「不適切コンテンツを通報する手段」を要求するため必須。
 */
export function ReportDialog({
  targetUserId, targetPostId, targetLabel, onClose,
}: {
  targetUserId?: string
  targetPostId?: string
  targetLabel: string
  onClose: () => void
}) {
  const { user } = useAuth()
  const { colors } = useTheme()

  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  /**
   * 送信に失敗したときの案内。
   *
   * ★ 黙って戻らないこと。
   *   以前はログを出して return するだけだったので、
   *   通信が切れていても画面は何も変わらなかった。
   *   押した人には送れたのか送れていないのか分からず、
   *   通報が届いたつもりのまま閉じられてしまう。
   *   通報は Guideline 1.2 の必須導線なので、
   *   静かに落ちるのがいちばん悪い。
   */
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!user || !reason) return
    setBusy(true)
    setError(null)

    const { error: err } = await supabase.from('reports').insert({
      reporter_id: user.id,
      target_user_id: targetUserId ?? null,
      target_post_id: targetPostId ?? null,
      reason,
      detail: detail.trim(),
    })
    setBusy(false)

    if (err) {
      console.warn('[report] 送信に失敗', err.message)
      setError('送信できませんでした。電波の良いところで、もう一度お試しください。')
      return
    }
    setDone(true)
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="閉じる">
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <Txt variant="heading">通報する</Txt>
          <View style={{ width: 24 }} />
        </View>

        {done ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={56} color={colors.geo} />
            <Txt variant="title" style={{ marginTop: space.lg, textAlign: 'center' }}>
              受け付けました
            </Txt>
            <Txt variant="body" tone="muted" style={{ marginTop: space.sm, textAlign: 'center' }}>
              内容を確認し、24時間以内に対応します。ご協力ありがとうございます。
            </Txt>
            <Button
              title="閉じる"
              variant="secondary"
              style={{ marginTop: space.xxl, alignSelf: 'stretch' }}
              onPress={onClose}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
            <Txt variant="small" tone="muted">
              {targetLabel} を通報します。理由を選んでください。
            </Txt>

            <View style={{ gap: space.sm }}>
              {REPORT_REASONS.map((r) => {
                const selected = reason === r
                return (
                  <Pressable
                    key={r}
                    onPress={() => setReason(r)}
                    style={[
                      styles.reason,
                      {
                        backgroundColor: selected ? colors.accentSoft : colors.surface,
                        borderColor: selected ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={selected ? colors.accent : colors.textFaint}
                    />
                    <Txt variant="body" style={{ flex: 1 }}>{r}</Txt>
                  </Pressable>
                )
              })}
            </View>

            <Field
              label="詳細（任意）"
              value={detail}
              onChangeText={setDetail}
              placeholder="状況を具体的に書いていただくと対応が早くなります"
              multiline
              numberOfLines={4}
              maxLength={500}
              style={{ minHeight: 80, textAlignVertical: 'top' }}
            />

            {error && (
              <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                <Txt variant="small" tone="danger" style={{ flex: 1 }}>{error}</Txt>
              </View>
            )}

            <Button
              title={error ? 'もう一度送信する' : '通報を送信'}
              onPress={submit}
              loading={busy}
              disabled={!reason}
            />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
})
