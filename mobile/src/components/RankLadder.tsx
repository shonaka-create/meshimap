import { StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme, space, radius } from '../theme'
import { Txt } from './ui'
import { RANKS, nextRank, progressToNext, type Rank } from '../lib/rank'

/**
 * ランクの階段。
 *
 * 以前はここに「あと◯件の投稿」という1行と、進捗のバーだけが出ていた。
 * 自分が5段のうちのどこに居るのか、この先に何があるのかが
 * 画面のどこにも無かったので、次の1段しか見えていなかった。
 *
 * 出すものは3つ。
 *   1. 全部で何段あって、いま何段目か（段の名前も全部見せる）
 *   2. 次の段に必要な条件が、それぞれ今いくつか（投稿数 / エリア数）
 *   3. 次に何をすればいいか
 *
 * ★ 段の数だけ横に並べるので、名前は必ず1行に丸めること。
 *   折り返すと段の区切りと文字の位置がずれて、
 *   どの名前がどの段のものか分からなくなる。
 */
export function RankLadder({
  rank, postsCount, areasCount,
}: {
  rank: Rank
  postsCount: number
  areasCount: number
}) {
  const { colors } = useTheme()
  const next = nextRank(rank)
  const progress = progressToNext(postsCount, areasCount, rank, next)

  return (
    <View style={{ gap: space.sm }}>
      {/* ── いまの段 ───────────────────────────── */}
      <View style={styles.row}>
        <View style={styles.nowRow}>
          <View style={[styles.dot, { backgroundColor: rank.frame }]} />
          <Txt variant="smallMed">{rank.name}</Txt>
        </View>
        <Txt variant="caption" tone="faint">
          ランク {rank.level} / {RANKS.length}
        </Txt>
      </View>

      {/* ── 段の帯。到達済みはその段の色で塗り、
             いま登っている段だけ途中まで塗る ───────────── */}
      <View style={styles.track}>
        {RANKS.map((r) => {
          const done = r.level <= rank.level
          const climbing = !!next && r.level === next.level
          return (
            <View
              key={r.level}
              style={[styles.seg, { backgroundColor: colors.border }]}
            >
              <View
                style={{
                  height: '100%',
                  width: done ? '100%' : climbing ? `${Math.max(progress * 100, 3)}%` : '0%',
                  backgroundColor: done ? r.frame : climbing ? r.frame : 'transparent',
                  opacity: done ? 1 : 0.75,
                }}
              />
            </View>
          )
        })}
      </View>

      {/* ── 段の名前 ───────────────────────────── */}
      <View style={styles.track}>
        {RANKS.map((r) => (
          <View key={r.level} style={{ flex: 1 }}>
            <Txt
              variant="small"
              tone={r.level === rank.level ? 'default' : 'faint'}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[
                styles.name,
                { fontWeight: r.level === rank.level ? '700' : '400' },
              ]}
            >
              {r.name}
            </Txt>
          </View>
        ))}
      </View>

      {/* ── 次の段に要るもの ──────────────────────
        * 条件は投稿数とエリア数の2つある。
        * まとめて1本の進捗にすると「どちらが足りないのか」が消える。
        */}
      {next ? (
        <View style={{ gap: 2, marginTop: 2 }}>
          <Txt variant="small" tone="muted">
            次は<Txt variant="smallMed">{next.name}</Txt>
          </Txt>
          <Need
            label="投稿"
            have={postsCount}
            need={next.posts}
            unit="件"
            color={next.frame}
          />
          <Need
            label="エリア"
            have={areasCount}
            need={next.areas}
            unit="エリア"
            color={next.frame}
          />
        </View>
      ) : (
        <Txt variant="small" tone="muted">
          最上位です。ここから先の段はありません。
        </Txt>
      )}

      {/* ── 何をすればいいか ────────────────────── */}
      <View style={styles.row}>
        <Txt variant="caption" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
          {next && areasCount < next.areas
            ? '行ったことのない街で記録すると早く上がります'
            : 'エリアは投稿した街の数です'}
        </Txt>
        <View style={styles.cta}>
          <Txt variant="caption" tone="accent">記録する</Txt>
          <Ionicons name="chevron-forward" size={12} color={colors.accent} />
        </View>
      </View>
    </View>
  )
}

/**
 * 条件1つぶんの行。
 * 「12 / 30」と「あと18件」を両方出す。
 * 割合だけだと具体的に何をすればいいか分からず、
 * 残数だけだとどれくらい進んだのかが分からない。
 */
function Need({
  label, have, need, unit, color,
}: {
  label: string
  have: number
  need: number
  unit: string
  color: string
}) {
  const { colors } = useTheme()
  const done = have >= need
  const ratio = need > 0 ? Math.min(have / need, 1) : 1

  return (
    <View style={styles.needRow}>
      <Txt variant="caption" tone="faint" style={styles.needLabel} numberOfLines={1}>
        {label}
      </Txt>
      <View style={[styles.needTrack, { backgroundColor: colors.border }]}>
        <View
          style={{
            height: '100%',
            width: `${Math.max(ratio * 100, done ? 100 : 2)}%`,
            backgroundColor: done ? colors.geo : color,
          }}
        />
      </View>
      <Txt variant="caption" tone={done ? 'muted' : 'default'} style={styles.needNum}>
        {done ? `達成 ${need}${unit}` : `あと${need - have}${unit}`}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  track: { flexDirection: 'row', gap: 3 },
  seg: { flex: 1, height: 5, overflow: 'hidden' },
  name: { fontSize: 9, lineHeight: 13, textAlign: 'center', letterSpacing: 0 },
  needRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  needLabel: { width: 40, letterSpacing: 0.4 },
  needTrack: { flex: 1, height: 4, overflow: 'hidden', borderRadius: radius.sq },
  needNum: { width: 78, textAlign: 'right', letterSpacing: 0.2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
})
