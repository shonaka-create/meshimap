import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { space } from '../theme'
import { Txt } from './ui'

/**
 * ログイン / 新規登録の背景。
 *
 * ここはアプリの第一印象で、他の画面とは役割が違う。
 * 中の画面（白のギャラリー）は静かに引くのが正解だが、入口まで静かだと
 * 「何のアプリなのか」が伝わらないまま終わる。だから入口だけは、
 * 個人店の灯りが見える写真を全面に敷いて、フォームを紙のように浮かせる。
 *
 * 写真の上に文字を置くので、可読性はスクリムで担保する。
 * 画像は暗い地の上に重ねるので、読み込みに失敗しても
 * 「暗い夜の店内」のまま成立し、白飛びした画面にはならない。
 */

/** 夜の個人店のカウンター。Unsplash ライセンス（商用利用可・帰属表示不要） */
const BACKDROP =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&q=80'

export function AuthBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      {/* 写真の読み込み前・失敗時に見えるのはこの墨色。白い箱が出るより破綻しない */}
      <StatusBar style="light" />

      <Image
        source={{ uri: BACKDROP }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={500}
        cachePolicy="memory-disk"
      />

      {/*
        スクリム。上は銘板、下はカードが乗るので、両端を濃くして中央を抜く。
        一様に暗くすると写真がただの汚れた背景になる。
      */}
      <LinearGradient
        colors={[
          'rgba(12,10,9,0.82)',
          'rgba(12,10,9,0.38)',
          'rgba(12,10,9,0.72)',
          'rgba(12,10,9,0.94)',
        ]}
        locations={[0, 0.34, 0.66, 1]}
        style={StyleSheet.absoluteFill}
      />

      {children}
    </View>
  )
}

/** 写真の上に置く銘板。明朝の見出しを白抜きで使う */
export function AuthBrand({ caption }: { caption: string }) {
  return (
    <View style={styles.brand}>
      <Txt variant="display" style={{ color: '#FFFFFF' }}>
        MeshiMap
      </Txt>
      <Txt variant="small" style={{ color: 'rgba(255,255,255,0.74)', marginTop: space.xs }}>
        {caption}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C0A09' },
  brand: { alignItems: 'center' },
})
