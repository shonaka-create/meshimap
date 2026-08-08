import { ScrollView, View } from 'react-native'
import { useTheme, space } from '../theme'
import { Txt } from './ui'

export interface Clause {
  heading: string
  body: string[]
}

/** 利用規約 / プライバシーポリシー共通の表示部 */
export function LegalDoc({
  updated, intro, clauses,
}: {
  updated: string
  intro: string
  clauses: Clause[]
}) {
  const { colors } = useTheme()

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xl }}
    >
      <View style={{ gap: space.xs }}>
        <Txt variant="caption" tone="faint">最終更新: {updated}</Txt>
        <Txt variant="body" tone="muted">{intro}</Txt>
      </View>

      {clauses.map((c, i) => (
        <View key={c.heading} style={{ gap: space.sm }}>
          <Txt variant="heading">{`${i + 1}. ${c.heading}`}</Txt>
          {c.body.map((p, j) => (
            <Txt key={j} variant="body" tone="muted">{p}</Txt>
          ))}
        </View>
      ))}
    </ScrollView>
  )
}
