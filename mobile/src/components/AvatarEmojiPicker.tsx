import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { useTheme, space, radius, shadow } from '../theme'
import { Txt, Button, Loading } from './ui'
import { RANKS, type AvatarEmoji, type Rank } from '../lib/rank'

interface Props {
  visible: boolean
  /** 現在のランク。これ以下の絵柄が選べる */
  rank: Rank
  current: string | null
  onClose: () => void
  onSelect: (emoji: string | null) => void
}

/**
 * アバターの絵柄を選ぶ。
 *
 * 一覧は avatar_emojis テーブルから取る。
 * 「どの絵柄がどのランクで解放されるか」を端末側に持たせると、
 * しきい値を変えたときに表示と実際の可否がズレるため。
 */
export function AvatarEmojiPicker({ visible, rank, current, onClose, onSelect }: Props) {
  const { colors } = useTheme()
  const [all, setAll] = useState<AvatarEmoji[] | null>(null)

  useEffect(() => {
    if (!visible || all) return
    supabase
      .from('avatar_emojis')
      .select('emoji, min_rank, sort_order')
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) {
          console.warn('[avatar] 絵柄の取得に失敗', error.message)
          setAll([])
          return
        }
        setAll((data ?? []) as AvatarEmoji[])
      })
  }, [visible, all])

  // ランクごとにまとめて「次に何が解放されるか」を見せる
  const groups = RANKS.map((r) => ({
    rank: r,
    items: (all ?? []).filter((e) => e.min_rank === r.level),
  })).filter((g) => g.items.length > 0)

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[styles.sheet, shadow.float, { backgroundColor: colors.surface }]}>
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
          </View>

          <View style={styles.header}>
            <Txt variant="heading">アイコンの絵柄</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="閉じる">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <Txt variant="small" tone="muted" style={{ paddingHorizontal: space.xl }}>
            投稿を重ねて街を巡ると、選べる絵柄が増えていきます。
          </Txt>

          {all === null ? (
            <View style={{ paddingVertical: space.xxxl }}><Loading /></View>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              {/* 写真に戻す */}
              <Pressable
                onPress={() => onSelect(null)}
                style={[
                  styles.photoRow,
                  {
                    borderColor: current === null ? colors.accent : colors.border,
                    backgroundColor: current === null ? colors.accentSoft : 'transparent',
                  },
                ]}
              >
                <Ionicons name="person-circle-outline" size={22} color={colors.textMuted} />
                <Txt variant="bodyMed" style={{ flex: 1 }}>プロフィール写真を使う</Txt>
                {current === null && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </Pressable>

              {groups.map(({ rank: r, items }) => {
                const unlocked = rank.level >= r.level
                return (
                  <View key={r.level} style={{ gap: space.sm }}>
                    <View style={styles.groupHead}>
                      <View style={[styles.dot, { backgroundColor: r.frame }]} />
                      <Txt variant="smallMed">{r.name}</Txt>
                      {!unlocked && (
                        <Txt variant="caption" tone="faint">
                          投稿{r.posts}件 · {r.areas}エリアで解放
                        </Txt>
                      )}
                    </View>

                    <View style={styles.grid}>
                      {items.map((e) => {
                        const selected = current === e.emoji
                        return (
                          <Pressable
                            key={e.emoji}
                            onPress={() => unlocked && onSelect(e.emoji)}
                            disabled={!unlocked}
                            accessibilityLabel={unlocked ? e.emoji : `${e.emoji}（未解放）`}
                            style={[
                              styles.tile,
                              {
                                borderColor: selected ? colors.accent : colors.border,
                                backgroundColor: selected ? colors.accentSoft : colors.surfaceAlt,
                                opacity: unlocked ? 1 : 0.4,
                              },
                            ]}
                          >
                            <Text style={{ fontSize: 26 }}>{unlocked ? e.emoji : '🔒'}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Button title="閉じる" variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: space.xl,
  },
  handleRow: { alignItems: 'center', paddingTop: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xs,
  },
  body: { padding: space.xl, gap: space.xl },
  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: 56, height: 56, borderRadius: radius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: { paddingHorizontal: space.xl, paddingTop: space.sm },
})
