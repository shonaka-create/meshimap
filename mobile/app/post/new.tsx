import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, View,
} from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import MapView, { Marker } from 'react-native-maps'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import { useAuth } from '../../src/hooks/useAuth'
import { useLocation } from '../../src/hooks/useLocation'
import { resolveRegion } from '../../src/lib/geocode'
import { MAP_PROVIDER } from '../../src/lib/mapProvider'
import {
  useTheme, space, radius, GENRES, GENRE_EMOJI, PRICE_RANGES,
  SITUATIONS, SITUATION_EMOJI,
  type Genre, type PriceRange,
} from '../../src/theme'
import { nearestArea, PREFECTURE_BY_ID } from '../../src/lib/regions'
import { Button, Chip, Field, Txt } from '../../src/components/ui'

/** 要件: 写真は5枚まで。動画は登録できない。 */
const MAX_IMAGES = 5

/**
 * 「地図で調整」を開いたときの表示範囲（緯度の度数）。
 *
 * 0.02（約2.2km）で始めていたが、その縮尺だと店の建物が点にもならず、
 * 毎回ピンチで寄せてから合わせることになっていた。
 * ここで欲しいのは「どの街か」ではなく「どの建物か」なので、
 * 0.003（約330m）まで寄せておく。街区が読める距離。
 *
 * 寄せすぎると今度は現在地がずれていたときに店を探しにくくなるため、
 * 一画面に数ブロック入るこのあたりが下限。
 */
const ADJUST_DELTA = 0.003

interface Picked {
  uri: string
  width: number
  height: number
}

export default function NewPost() {
  const { user, profile } = useAuth()
  const { colors } = useTheme()
  const router = useRouter()
  const { coords, locate } = useLocation()
  const mapRef = useRef<MapView>(null)

  const [images, setImages] = useState<Picked[]>([])
  const [caption, setCaption] = useState('')
  const [rating, setRating] = useState(0)
  const [genre, setGenre] = useState<Genre>('その他')
  const [priceRange, setPriceRange] = useState<PriceRange>('¥1,001〜¥3,000')
  const [situations, setSituations] = useState<string[]>([])
  const [locationName, setLocationName] = useState('')
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null)
  const [isPublic, setIsPublic] = useState(false) // 要件: 初期は非公開
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')

  /**
   * 地図は必要になるまで描画しない。
   * Google Maps は「地図を1回読み込むごと」に課金される（パン/ズームは無料）ため、
   * 位置を微調整しない人の分の読み込みを丸ごと節約できる。
   */
  const [showMap, setShowMap] = useState(false)

  /* ── 初期位置は現在地に寄せる ────────────────────── */
  useEffect(() => {
    locate().then((c) => {
      if (c && !pin) {
        setPin(c)
        // 地図はまだ描画していない（showMap が false）ので、
        // ここで動かす相手はいない。開いたときの位置は
        // 下の initialRegion が ADJUST_DELTA で決める。
      }
    })
    // 初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 写真を選ぶ（画像のみ・5枚まで） ───────────────── */
  const pickImages = useCallback(async () => {
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      Alert.alert('写真は5枚までです', '追加するには、どれかを削除してください。')
      return
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('写真へのアクセスが必要です', '設定アプリから写真の許可を有効にしてください。')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // 動画は選択肢に出さない。要件通り画像のみ。
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
      exif: false,
    })
    if (result.canceled) return

    // ライブラリが動画を返してきた場合の保険（機種差の実害を防ぐ）
    const onlyImages = result.assets.filter((a) => a.type !== 'video')
    if (onlyImages.length < result.assets.length) {
      Alert.alert('動画は投稿できません', '写真のみ登録できます。')
    }

    setImages((prev) =>
      [...prev, ...onlyImages.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))]
        .slice(0, MAX_IMAGES)
    )
  }, [images.length])

  const removeImage = (uri: string) =>
    setImages((prev) => prev.filter((i) => i.uri !== uri))

  /* ── 投稿 ───────────────────────────────────── */
  const submit = useCallback(async () => {
    if (!user || !pin || images.length === 0 || rating === 0 || !locationName.trim()) return

    setUploading(true)

    // 途中で失敗したときに取り消す対象。投稿は「全部そろって成立」にする。
    let createdPostId: string | null = null
    const uploadedPaths: string[] = []

    try {
      // 1. 都道府県とエリアを決める（地図の階層集計に使う）。
      //    内蔵データで決まればここで API は一切消費しない。
      setProgress('場所を確認しています…')
      const region = await resolveRegion(pin.latitude, pin.longitude)

      // 2. 投稿レコード
      setProgress('投稿を作成しています…')
      const hashtags = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1))

      const { data: post, error: postErr } = await supabase
        .from('posts')
        .insert({
          user_id: user.id,
          caption: caption.trim(),
          rating,
          genre,
          price_range: priceRange,
          location_name: locationName.trim(),
          location_lat: pin.latitude,
          location_lng: pin.longitude,
          is_public: isPublic,
          prefecture: region.prefecture,
          city: region.city,
          area: region.area,
          situations,
          hashtags,
        })
        .select()
        .single()

      if (postErr || !post) throw postErr ?? new Error('投稿の作成に失敗しました')
      createdPostId = post.id

      // 3. 画像を縮小してアップロード
      for (let i = 0; i < images.length; i++) {
        setProgress(`写真をアップロード中… ${i + 1}/${images.length}`)

        // 原寸のままだと数MBになり通信量と表示速度を圧迫するので長辺1600pxに落とす
        const manipulated = await ImageManipulator.manipulateAsync(
          images[i].uri,
          [{ resize: { width: Math.min(images[i].width || 1600, 1600) } }],
          { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
        )

        const res = await fetch(manipulated.uri)
        const bytes = await res.arrayBuffer()

        // Storage ポリシーが先頭フォルダ = 自分のUID を要求するのでこの形を守る
        const path = `${user.id}/${post.id}/${i}.jpg`
        const { error: upErr } = await supabase.storage
          .from('post-images')
          .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
        if (upErr) throw upErr
        uploadedPaths.push(path)

        const { data: pub } = supabase.storage.from('post-images').getPublicUrl(path)
        const { error: imgErr } = await supabase
          .from('post_images')
          .insert({ post_id: post.id, url: pub.publicUrl, position: i })
        if (imgErr) throw imgErr
      }

      // 4. 成果画面へ。
      //    「投稿できた」で終わらせず、何が積み上がったのかを見せる。
      //    カウンタはDBのトリガーが更新するので、投稿前の値を渡して
      //    向こう側で最新と突き合わせる。
      router.replace({
        pathname: '/post/done',
        params: {
          postsBefore: String(profile?.posts_count ?? 0),
          areasBefore: String(profile?.areas_count ?? 0),
          area: region.area ?? region.city ?? '',
          prefecture: region.prefecture ?? '',
          locationName: locationName.trim(),
          isPublic: isPublic ? '1' : '0',
        },
      })
    } catch (e) {
      // 作りかけを消す。これをやらないと「投稿に失敗」と出ているのに
      // 画像なしの投稿が残り、押し直すたびに増えていく。
      // posts を消せば post_images は ON DELETE CASCADE で消え、
      // posts_count もトリガーが戻すので、投稿前の状態に戻る。
      setProgress('取り消しています…')
      try {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from('post-images').remove(uploadedPaths)
        }
        if (createdPostId) {
          await supabase.from('posts').delete().eq('id', createdPostId)
        }
      } catch (cleanupErr) {
        // 取り消しにも失敗した場合は元のエラーを優先して見せる。
        console.warn('[new] 失敗した投稿の取り消しに失敗しました', cleanupErr)
      }

      Alert.alert('投稿に失敗しました', (e as Error)?.message ?? '不明なエラー')
    } finally {
      setUploading(false)
      setProgress('')
    }
  }, [user, profile, pin, images, rating, locationName, caption, genre, priceRange, situations, isPublic, router])

  const toggleSituation = (s: string) =>
    setSituations((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  /** ピンの位置から内蔵データで決まるエリア名。API を使わずに即座に出せる。 */
  const areaPreview = pin ? nearestArea(pin.latitude, pin.longitude) : null

  /** 同名のエリアが他県にもあるので、県名を添えて取り違えを防ぐ。 */
  const areaPrefecture = areaPreview
    ? PREFECTURE_BY_ID[areaPreview.area.prefId]?.name ?? null
    : null

  const canSubmit =
    images.length > 0 && rating > 0 && !!locationName.trim() && !!pin && !uploading

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>

        {/* ── 写真 ─────────────────────────────── */}
        <View style={{ gap: space.sm }}>
          <View style={styles.labelRow}>
            <Txt variant="smallMed" tone="muted">写真</Txt>
            <Txt variant="small" tone="faint">{images.length} / {MAX_IMAGES}（動画は不可）</Txt>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {images.map((img) => (
              <View key={img.uri}>
                <Image
                  source={{ uri: img.uri }}
                  style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]}
                  contentFit="cover"
                />
                <Pressable
                  onPress={() => removeImage(img.uri)}
                  hitSlop={8}
                  accessibilityLabel="この写真を削除"
                  style={styles.removeBtn}
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}

            {images.length < MAX_IMAGES && (
              <Pressable
                onPress={pickImages}
                style={[styles.addThumb, { borderColor: colors.border, backgroundColor: colors.surface }]}
              >
                <Ionicons name="images-outline" size={26} color={colors.textFaint} />
                <Txt variant="caption" tone="faint">追加</Txt>
              </Pressable>
            )}
          </ScrollView>
        </View>

        {/* ── 店名 ─────────────────────────────── */}
        <Field
          label="お店の名前"
          value={locationName}
          onChangeText={setLocationName}
          placeholder="例: 麺屋 こうじ"
          maxLength={60}
        />

        {/* ── 評価 ─────────────────────────────── */}
        <View style={{ gap: space.sm }}>
          <Txt variant="smallMed" tone="muted">評価</Txt>
          <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable
                key={s}
                onPress={() => setRating(s)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`${s}つ星`}
              >
                <Ionicons
                  name={s <= rating ? 'star' : 'star-outline'}
                  size={30}
                  color={s <= rating ? colors.star : colors.borderStrong}
                />
              </Pressable>
            ))}
            <Txt variant="small" tone="muted" style={{ marginLeft: space.sm }}>
              {rating > 0 ? `${rating}.0` : '未評価'}
            </Txt>
          </View>
        </View>

        {/* ── ジャンル ───────────────────────────── */}
        <View style={{ gap: space.sm }}>
          <Txt variant="smallMed" tone="muted">ジャンル</Txt>
          <View style={styles.wrap}>
            {GENRES.map((g) => (
              <Chip
                key={g}
                label={`${GENRE_EMOJI[g]} ${g}`}
                selected={genre === g}
                onPress={() => setGenre(g)}
              />
            ))}
          </View>
        </View>

        {/* ── 価格帯 ───────────────────────────── */}
        <View style={{ gap: space.sm }}>
          <Txt variant="smallMed" tone="muted">価格帯</Txt>
          <View style={styles.wrap}>
            {PRICE_RANGES.map((p) => (
              <Chip
                key={p}
                label={p}
                selected={priceRange === p}
                onPress={() => setPriceRange(p)}
              />
            ))}
          </View>
        </View>

        {/* ── シチュエーション ───────────────────── */}
        <View style={{ gap: space.sm }}>
          <View style={styles.labelRow}>
            <Txt variant="smallMed" tone="muted">シチュエーション</Txt>
            <Txt variant="small" tone="faint">複数選べます・任意</Txt>
          </View>
          <View style={styles.wrap}>
            {SITUATIONS.map((s) => (
              <Chip
                key={s}
                label={`${SITUATION_EMOJI[s]} ${s}`}
                selected={situations.includes(s)}
                onPress={() => toggleSituation(s)}
              />
            ))}
          </View>
        </View>

        {/* ── キャプション ─────────────────────── */}
        <Field
          label="ひとこと"
          value={caption}
          onChangeText={setCaption}
          placeholder="感想や思い出を… #ランチ #新宿"
          multiline
          maxLength={1000}
          style={{ minHeight: 88, textAlignVertical: 'top' }}
          hint="#タグ を付けると検索で見つけてもらいやすくなります。"
        />

        {/* ── 場所 ─────────────────────────────── */}
        <View style={{ gap: space.sm }}>
          <View style={styles.labelRow}>
            <Txt variant="smallMed" tone="muted">場所</Txt>
            {showMap && <Txt variant="small" tone="faint">地図をタップしてピンを置く</Txt>}
          </View>

          {/* 現在地でよければ地図を開かせない。
              Google Maps は地図の読み込み1回ごとに課金されるため、
              「調整する人だけが地図を開く」導線にしている。 */}
          {!showMap ? (
            <View style={[styles.locationCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons
                name={pin ? 'location' : 'location-outline'}
                size={20}
                color={pin ? colors.geo : colors.textFaint}
              />
              <View style={{ flex: 1 }}>
                {pin ? (
                  <>
                    <Txt variant="bodyMed">
                      {areaPreview ? areaPreview.area.name : '現在地'}
                    </Txt>
                    {/* 緯度経度は出さない。読んでも判断に使えず、
                        桁の並びが不安を与えるだけだった。
                        代わりに県名を出す。「中野」のように
                        同じ名前のエリアが他県にもあるため、
                        ここで取り違えに気付ける。 */}
                    <Txt variant="small" tone="muted">
                      {areaPrefecture ?? '地図で正確な位置を指定できます'}
                    </Txt>
                  </>
                ) : (
                  <Txt variant="small" tone="muted">
                    現在地を取得できませんでした。地図から選んでください。
                  </Txt>
                )}
              </View>
              <Button
                title="地図で調整"
                variant="secondary"
                style={{ height: 38, paddingHorizontal: space.md }}
                onPress={() => setShowMap(true)}
              />
            </View>
          ) : (
            <View style={[styles.mapBox, { borderColor: colors.border }]}>
              <MapView
                ref={mapRef}
                provider={MAP_PROVIDER}
                style={{ flex: 1 }}
                initialRegion={{
                  latitude: pin?.latitude ?? coords?.latitude ?? 35.6812,
                  longitude: pin?.longitude ?? coords?.longitude ?? 139.7671,
                  latitudeDelta: ADJUST_DELTA,
                  longitudeDelta: ADJUST_DELTA,
                }}
                showsUserLocation
                showsMyLocationButton={false}
                onPress={(e) => setPin(e.nativeEvent.coordinate)}
              >
                {pin && <Marker coordinate={pin} pinColor={colors.accent} />}
              </MapView>
            </View>
          )}

          {pin ? (
            <View style={styles.labelRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.geo} />
              <Txt variant="small" tone="muted">
                {areaPreview
                  ? `「${areaPreview.area.name}」として地図に載ります`
                  : '都道府県は投稿時に自動判定します'}
              </Txt>
            </View>
          ) : (
            <Txt variant="small" tone="danger">場所を指定してください</Txt>
          )}
        </View>

        {/* ── 公開設定 ───────────────────────────── */}
        <Pressable
          onPress={() => setIsPublic((v) => !v)}
          style={[styles.publicRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: isPublic }}
        >
          <Ionicons
            name={isPublic ? 'earth' : 'lock-closed'}
            size={20}
            color={isPublic ? colors.geo : colors.textMuted}
          />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyMed">{isPublic ? 'この投稿を公開する' : 'この投稿は非公開'}</Txt>
            <Txt variant="small" tone="muted">
              {isPublic
                ? 'アカウントを公開設定にしていれば、検索から誰でも見られます。'
                : '自分だけが見られます。あとからプロフィールで切り替えられます。'}
            </Txt>
          </View>
          <Ionicons
            name={isPublic ? 'toggle' : 'toggle-outline'}
            size={30}
            color={isPublic ? colors.accent : colors.textFaint}
          />
        </Pressable>

        {uploading && (
          <View style={styles.labelRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Txt variant="small" tone="muted">{progress}</Txt>
          </View>
        )}

        <Button
          title="投稿する"
          onPress={submit}
          loading={uploading}
          disabled={!canSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  addThumb: {
    width: 96, height: 96, borderRadius: radius.md,
    borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  removeBtn: {
    position: 'absolute', top: 5, right: 5,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  mapBox: { height: 220, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1 },
  locationCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
  publicRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
})
