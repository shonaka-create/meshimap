import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  useTheme, space, radius, GENRES, PRICE_RANGES, SITUATIONS,
} from '../../src/theme'
import { Button, Chip, Txt } from '../../src/components/ui'
import { useLocation } from '../../src/hooks/useLocation'
import { RADIUS_OPTIONS, type RecommendScope } from '../../src/lib/recommend'

/**
 * 「今日どこ行く？」— 条件を選ぶ画面。
 *
 * ★ この画面には入力欄を置かない。
 *   行き先が決まっていない人が使う画面なので、
 *   打つべき言葉を思いつけること自体が前提にできない。
 *   「検索」と役割が被らないのもここ（あちらは名前を知っている人のための画面）。
 *
 * 条件はすべて省略できる。何も選ばずに押しても
 * 「自分に見える店を、評価と届いた人数で並べたもの」が出る。
 * 選ばないと進めない画面は、迷っている人をそこで止めてしまう。
 */
export default function Pick() {
  const { colors } = useTheme()
  const router = useRouter()
  const { coords, permission, locating, locate } = useLocation()

  const [situations, setSituations] = useState<string[]>([])
  const [prices, setPrices] = useState<string[]>([])
  const [genres, setGenres] = useState<string[]>([])
  const [radiusKm, setRadiusKm] = useState<number | null>(null)
  const [scope, setScope] = useState<RecommendScope>('all')
  const [excludeVisited, setExcludeVisited] = useState(true)

  const toggle = useCallback(
    (list: string[], set: (v: string[]) => void, value: string) => {
      set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
    },
    []
  )

  /**
   * 半径を選んだ時点で現在地を取りに行く。
   * 「おすすめを見る」を押してから許可を求めると、
   * 結果を待っている最中にダイアログが出て何が起きたのか分からなくなる。
   */
  const chooseRadius = useCallback(async (km: number | null) => {
    setRadiusKm(km)
    if (km !== null && !coords) {
      const got = await locate()
      // 許可されなければ距離は使えない。黙って全国に戻す（案内は下に出る）
      if (!got) setRadiusKm(null)
    }
  }, [coords, locate])

  const chosen = situations.length + prices.length + genres.length

  const submit = useCallback(() => {
    router.push({
      pathname: '/pick/results',
      params: {
        // 予算の文字列に「,」が入る（¥1,001〜¥3,000）ので、
        // 区切り文字で繋がず JSON で渡す
        situations: JSON.stringify(situations),
        prices: JSON.stringify(prices),
        genres: JSON.stringify(genres),
        scope,
        radiusKm: radiusKm === null ? '' : String(radiusKm),
        lat: radiusKm !== null && coords ? String(coords.latitude) : '',
        lng: radiusKm !== null && coords ? String(coords.longitude) : '',
        excludeVisited: excludeVisited ? '1' : '',
      },
    })
  }, [router, situations, prices, genres, scope, radiusKm, coords, excludeVisited])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <Txt variant="display">今日どこ行く？</Txt>
          <Txt variant="small" tone="muted">
            選ぶだけで、実際に誰かが行った店から提案します。
          </Txt>
        </View>

        <Section
          title="どんな場面"
          note="いちばん効く条件です。選ばなければ場面では絞りません。"
        >
          {SITUATIONS.map((s) => (
            <Chip
              key={s}
              label={s}
              selected={situations.includes(s)}
              onPress={() => toggle(situations, setSituations, s)}
            />
          ))}
        </Section>

        <Section title="予算">
          {PRICE_RANGES.map((p) => (
            <Chip
              key={p}
              label={p}
              selected={prices.includes(p)}
              onPress={() => toggle(prices, setPrices, p)}
            />
          ))}
        </Section>

        <Section title="ジャンル">
          {GENRES.map((g) => (
            <Chip
              key={g}
              label={g}
              selected={genres.includes(g)}
              onPress={() => toggle(genres, setGenres, g)}
            />
          ))}
        </Section>

        <Section
          title="どこで"
          note={
            permission === 'denied'
              ? '位置情報が許可されていないため、距離では絞れません。端末の設定から許可すると近い順に出せます。'
              : locating
                ? '現在地を確認しています…'
                : undefined
          }
        >
          {RADIUS_OPTIONS.map((r) => (
            <Chip
              key={r.label}
              label={r.label}
              selected={radiusKm === r.km}
              onPress={() => chooseRadius(r.km)}
            />
          ))}
        </Section>

        <Section
          title="だれの投稿から"
          note={
            scope === 'following'
              ? 'フォローしている人が行った店だけを見ます。'
              : '公開アカウントの投稿も含めて広く見ます。非公開の投稿は含まれません。'
          }
        >
          <Chip label="みんな" selected={scope === 'all'} onPress={() => setScope('all')} />
          <Chip
            label="フォロー中だけ"
            selected={scope === 'following'}
            onPress={() => setScope('following')}
          />
        </Section>

        <Pressable
          onPress={() => setExcludeVisited((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: excludeVisited }}
          style={({ pressed }) => [
            styles.check,
            { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons
            name={excludeVisited ? 'checkbox' : 'square-outline'}
            size={20}
            color={excludeVisited ? colors.accent : colors.textFaint}
          />
          <View style={{ flex: 1 }}>
            <Txt variant="smallMed">まだ行っていない店だけ</Txt>
            <Txt variant="small" tone="faint">
              自分が投稿した店を候補から外します
            </Txt>
          </View>
        </Pressable>

      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>
        <Button
          title={chosen > 0 ? `${chosen}つの条件で探す` : 'おすすめを見る'}
          onPress={submit}
          loading={locating}
        />
      </View>
    </SafeAreaView>
  )
}

function Section({
  title, note, children,
}: { title: string; note?: string; children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.section, { borderTopColor: colors.border }]}>
      <Txt variant="heading">{title}</Txt>
      {note && (
        <Txt variant="small" tone="faint" style={{ marginTop: -2 }}>{note}</Txt>
      )}
      <View style={styles.chips}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: space.xs },
  section: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    marginTop: space.lg,
    padding: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
