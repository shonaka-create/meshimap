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
import { Stack, useRouter } from 'expo-router'
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
import { searchPlaces, resolveStoreLocation, type PlaceHit } from '../../src/lib/placeSearch'
import {
  anyProhibitedContent, isProhibitedContentError, PROHIBITED_CONTENT_MESSAGE,
} from '../../src/lib/moderation'
import { Button, Chip, Field, Txt } from '../../src/components/ui'
import { HeaderClose } from '../../src/components/HeaderBack'

/**
 * 要件: 写真は5枚まで。動画は登録できない。
 *
 * ★ supabase/migrations/0016_post_image_limit.sql と対。
 *   向こうは post_images の position を 0〜4 に限り、
 *   (post_id, position) を重複させないことで構造的に止めている。
 *   片方だけ変えると、6枚目が選べるのに保存で弾かれる
 *   （またはその逆）という食い違いになる。
 */
const MAX_IMAGES = 5

/**
 * DB の枚数制限に弾かれたエラーか（移行 0016）。
 *
 * PostgREST は制約名をそのままメッセージに載せてくるので、
 * それを見て日本語に直す（lib/moderation.ts の
 * isProhibitedContentError と同じやり方）。
 */
function isImageLimitError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? ''
  return (
    msg.includes('post_images_position_range') ||
    msg.includes('post_images_post_position_key')
  )
}

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

/** 写真の長辺の上限(px)。これを超える辺だけを縮める */
const MAX_IMAGE_EDGE = 1600

/**
 * 長い方の辺を MAX_IMAGE_EDGE に合わせる resize 引数を作る。
 * 縮める必要が無ければ null を返す（呼び出し側は resize を渡さない）。
 *
 * ImageManipulator は width / height の片方だけを渡すと縦横比を保つので、
 * 長い方だけを指定すればよい。
 *
 * ★ 引き伸ばさないこと。
 *   元から小さい写真に width: 1600 を渡すと、拡大されて
 *   画質が落ちたうえにファイルまで大きくなる。
 *   サイズが読めなかったときも同じで、決め打ちで 1600 を渡すと
 *   小さい写真を引き伸ばしうる。読めないなら縮めない
 *   （その場合も compress は効くので、素の原寸のままにはならない）。
 */
function resizeToLongEdge(width?: number, height?: number) {
  if (!width || !height) return null
  if (Math.max(width, height) <= MAX_IMAGE_EDGE) return null
  return width >= height ? { width: MAX_IMAGE_EDGE } : { height: MAX_IMAGE_EDGE }
}

interface Picked {
  uri: string
  width: number
  height: number
}

/**
 * 地図のカメラを動かす。
 *
 * ★ ネイティブ呼び出しなので必ず囲むこと。
 *   react-native-maps は新アーキテクチャに非対応で互換層越しに動く。
 *   画面を閉じた直後や MapView が作り直された直後に呼ぶと、
 *   ref はあるのに内側が入れ替わっていて投げることがある。
 *   ピンの位置が合わないのは困るが、それで落ちるのはもっと困る。
 *
 * ★ コンポーネントの外に置くこと。
 *   中で useCallback にすると、React Compiler が
 *   「既存のメモ化を保てない」と言って最適化を丸ごと諦める
 *   （lint が error で止める）。ref を引数で受ければ、
 *   ただの関数で済むので、その問題自体が起きない。
 */
function moveCamera(
  ref: React.RefObject<MapView | null>,
  to: { latitude: number; longitude: number }
) {
  try {
    ref.current?.animateToRegion(
      { ...to, latitudeDelta: ADJUST_DELTA, longitudeDelta: ADJUST_DELTA },
      500
    )
  } catch (e) {
    console.warn('[post] 地図を動かせませんでした', e)
  }
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

  /**
   * 場所の検索。
   *
   * それまでは「現在地」か「地図をタップ」しか無かった。家に帰ってから
   * 昼の店を投稿する人にとっては、地図を指でたぐって探すしかない状態だった。
   *
   * 店名でも引ける（lib/placeSearch.ts）。探し先は
   * 「過去の投稿の店名 → 店名の候補(Places) → 内蔵エリア → 端末の地理コーダ」。
   * 費用の出る Places はサーバー経由で、1日の上限もサーバーが持っている。
   */
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<PlaceHit[]>([])
  const [placeSearching, setPlaceSearching] = useState(false)
  const [placeSearched, setPlaceSearched] = useState(false)
  /** 店名の検索が今日の上限に達した。過去データと地名では引けている */
  const [placeCapped, setPlaceCapped] = useState(false)
  /** 押された候補の座標を取りに行っている最中。二度押しを防ぐ */
  const [resolvingPlace, setResolvingPlace] = useState<string | null>(null)

  /**
   * 地図が動かせる状態か。
   * iOS の animateToRegion は、地図が組み上がる前に呼んでも
   * 黙って捨てられる。検索結果を押した直後がちょうどその窓に当たる。
   */
  /**
   * 候補を選んでいる最中か。
   * 座標を取りに行っている間に別の候補を押させないための鍵で、
   * 描画を挟まずに読めるよう state ではなく ref で持つ（choosePlace 参照）。
   */
  const choosingPlace = useRef(false)

  /**
   * 地図をいま開いているか。
   *
   * ★ 座標の取得を待っている間に「地図で調整」を押されることがある。
   *   choosePlace は非同期なので、閉じていた頃の showMap を掴んだままになり、
   *   取得が終わってもカメラを動かさずに帰ってしまう（選んだ店が画面の外に残る）。
   *   待ったあとは、こちらの最新の値で判断する。
   */
  const showMapRef = useRef(false)

  /**
   * この画面がまだ出ているか。
   *
   * ★ 座標の取得を待っている間に閉じられることがある。
   *   そのまま続けると、次の画面の上に
   *   「店名は入れておきました」のアラートが出る。
   *   待ったあとは必ずこれを見て、閉じられていたら何もせずに帰る。
   */
  const alive = useRef(true)

  const mapReady = useRef(false)
  /** 地図が準備できる前に決まった行き先。準備できた瞬間に動かす */
  const pendingRegion = useRef<{ latitude: number; longitude: number } | null>(null)

  // 地図の開閉を ref に写す。非同期の途中で最新の状態を見るため（showMapRef 参照）
  useEffect(() => { showMapRef.current = showMap }, [showMap])

  // 閉じられたことを覚えておく。閉じたあとに状態を触らないため（alive 参照）
  useEffect(() => () => { alive.current = false }, [])

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

    // ★ ネイティブの呼び出しは必ず try で囲むこと。
    //   権限ダイアログを OS 側から中断されたときや、
    //   ピッカー自体が失敗したときに拒否される。
    //   囲まないと未処理の Promise 拒否になり、
    //   「＋を押しても何も起きない」という形でしか表に出ない。
    let result: ImagePicker.ImagePickerResult
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('写真へのアクセスが必要です', '設定アプリから写真の許可を有効にしてください。')
        return
      }

      result = await ImagePicker.launchImageLibraryAsync({
        // 動画は選択肢に出さない。要件通り画像のみ。
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
        exif: false,
      })
    } catch (e) {
      console.warn('[post] 写真を選べませんでした', e)
      Alert.alert('写真を開けませんでした', '時間をおいて、もう一度お試しください。')
      return
    }

    if (result.canceled) return

    // ライブラリが動画を返してきた場合の保険（機種差の実害を防ぐ）
    const onlyImages = (result.assets ?? []).filter((a) => a.type !== 'video')
    if (onlyImages.length < (result.assets?.length ?? 0)) {
      Alert.alert('動画は投稿できません', '写真のみ登録できます。')
    }

    // ★ uri が無いものを混ぜないこと。
    //   端末が不完全な項目を返すことがある。そのまま持つと、
    //   表示のときは expo-image、投稿のときは ImageManipulator と、
    //   ネイティブ境界の両方へ空の uri が流れる。
    const usable = onlyImages.filter((a) => typeof a.uri === 'string' && a.uri.length > 0)

    setImages((prev) =>
      [...prev, ...usable.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))]
        .slice(0, MAX_IMAGES)
    )
  }, [images.length])

  const removeImage = (uri: string) =>
    setImages((prev) => prev.filter((i) => i.uri !== uri))

  /* ── 場所を言葉で探す ───────────────────────────
   * 打つたびに走らせず、確定したときだけ走らせる。
   * 端末の地理コーダは1文字ごとに叩くようにはできていない。
   */
  const runPlaceSearch = useCallback(async () => {
    const q = placeQuery.trim()
    if (q.length < 2) return

    setPlaceSearching(true)
    try {
      // 現在地を渡すと、同名のチェーン店のうち近いものが上に出る
      const { hits, capped } = await searchPlaces(q, coords ?? null)
      setPlaceResults(hits)
      setPlaceCapped(capped)
      setPlaceSearched(true)
    } finally {
      setPlaceSearching(false)
    }
  }, [placeQuery, coords])

  /** 検索結果を選ぶ。ピンを置いて、そのまま地図で確かめられるようにする */
  const choosePlace = useCallback(async (hit: PlaceHit) => {
    // ★ 座標を取りに行っている間、次の選択を受け付けないこと。
    //   受け付けると、あとから押した店を決めた後に、先に押した店の
    //   応答が返ってきて店名とピンを上書きする（選んだ店と違う場所が入る）。
    //   同じ候補の連打も、そのぶん有料の呼び出しが増える。
    //   state ではなく ref で見るのは、連打が同じ描画の中で起きるため。
    if (choosingPlace.current) return
    choosingPlace.current = true

    try {
      // 店名の候補（Places）は、押されるまで座標を持っていない。
      // 選ばれた1件についてだけ取りに行く（候補全件ぶん取ると課金が増える）。
      let next: { latitude: number; longitude: number } | null =
        hit.latitude !== null && hit.longitude !== null
          ? { latitude: hit.latitude, longitude: hit.longitude }
          : null

      if (!next && hit.placeId) {
        setResolvingPlace(hit.placeId)
        try {
          next = await resolveStoreLocation(hit.placeId)
        } finally {
          setResolvingPlace(null)
        }

        // ★ 待っている間に閉じられていたら、ここで帰ること。
        //   続けると、次の画面の上にこの画面のアラートが出る。
        if (!alive.current) return
      }

      if (!next) {
        // ★ 前のピンを必ず外すこと。
        //   店名だけが新しい店に変わって座標が前のまま（現在地や別の店）だと、
        //   地図を触らずに「選んだ店の名前＋無関係な場所」で投稿できてしまう。
        //   外せば canSubmit が成立しないので、置き直すまで投稿は通らない。
        //
        // ★ 投稿そのものは止めない。店名は入れておいて、位置だけ地図で決めてもらう。
        if (hit.isStore) setLocationName(hit.name)
        setPin(null)
        pendingRegion.current = null
        setShowMap(true)
        Alert.alert(
          '場所を取得できませんでした',
          '店名は入れておきました。地図をタップして位置を指定してください。'
        )
        return
      }

      // 店を選んだときは、店名の欄も埋める。ここで入れておけば、
      // 同じ名前をもう一度打たせずに済む（あとから直せる）。
      if (hit.isStore) setLocationName(hit.name)

      setPin(next)
      setPlaceResults([])
      setPlaceSearched(false)
      setPlaceQuery('')

      // ★ 検索で寄せた場所は、店そのものではなく「その街」であることが多い。
      //   置きっぱなしにさせず、必ず地図を開いて微調整させる。
      //   待っている間に開かれていることがあるので、ref の最新の値で見る。
      if (!showMapRef.current) {
        // まだ開いていない。マウント時の initialRegion がこのピンを使う
        setShowMap(true)
        return
      }

      if (mapReady.current) {
        moveCamera(mapRef, next)
        return
      }

      // ★ 開いてはいるが、まだ組み上がっていない。
      //   この状態で animateToRegion を呼んでも iOS では黙って捨てられ、
      //   ピンだけ動いて地図が前の場所に取り残される。
      //   行き先を持っておいて、onMapReady で動かす。
      pendingRegion.current = next
    } finally {
      // 上の return のどれを通っても必ず外す。外し忘れると、
      // 以後どの候補を押しても何も起きない画面になる。
      choosingPlace.current = false
    }
  }, [showMap])

  /** 地図が組み上がった。保留していた行き先があれば動かす */
  const onMapReady = useCallback(() => {
    mapReady.current = true

    const pending = pendingRegion.current
    pendingRegion.current = null
    if (!pending) return

    // 最初の描画が終わる前に動かすと取りこぼすので、1フレーム待つ
    requestAnimationFrame(() => moveCamera(mapRef, pending))
  }, [])

  /* ── 投稿 ───────────────────────────────────── */
  const submit = useCallback(async () => {
    if (!user || !pin || images.length === 0 || rating === 0 || !locationName.trim()) return

    // ★ ボタンの無効化だけに頼らないこと。
    //   押した瞬間と、この関数が走る瞬間の間にも選択は進む。
    //   取得中の投稿は、選ぶ前の場所で保存されるので必ずここで止める。
    if (choosingPlace.current) return

    /* ── 不適切な表現の確認（Guideline 1.2）─────────────────
     * ★ 写真を1枚も上げる前に見る。
     *   アップロードしてから弾くと、投稿レコードは消えても
     *   Storage に画像だけが残る。順番を変えないこと。
     * 端末側をすり抜けても、DBのトリガーが最後に止める。 */
    if (anyProhibitedContent(locationName, caption)) {
      Alert.alert('投稿できません', PROHIBITED_CONTENT_MESSAGE)
      return
    }

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

        // 原寸のままだと数MBになり通信量と表示速度を圧迫するので長辺1600pxに落とす。
        //
        // ★ width だけ渡さないこと。
        //   ImageManipulator は片方だけ指定すると縦横比を保つので、
        //   width を 1600 にしても縦長の写真は縦が 2133px のまま残る。
        //   iPhone の写真は縦持ちが普通なので、実際にはほとんどが
        //   縮みきっていなかった。長い方の辺を 1600 にする。
        const resize = resizeToLongEdge(images[i].width, images[i].height)
        const manipulated = await ImageManipulator.manipulateAsync(
          images[i].uri,
          resize ? [{ resize }] : [],
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

      // DBのトリガーに止められた場合は、素のSQLエラーではなく
      // 端末側で弾いたときと同じ文言を出す。
      if (isProhibitedContentError(e)) {
        Alert.alert('投稿できません', PROHIBITED_CONTENT_MESSAGE)
      } else if (isImageLimitError(e)) {
        // 端末側の上限をすり抜けてここに来ることは普通は無い。
        // 制約名がそのまま出ると何のことか分からないので、日本語にする。
        Alert.alert('投稿できません', `写真は${MAX_IMAGES}枚までです。`)
      } else {
        Alert.alert('投稿に失敗しました', (e as Error)?.message ?? '不明なエラー')
      }
    } finally {
      setUploading(false)
      setProgress('')
    }
  }, [user, profile, pin, images, rating, locationName, caption, genre, priceRange, situations, isPublic, router])

  const toggleSituation = (s: string) =>
    setSituations((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  /** ピンの位置から内蔵データで決まるエリア名。API を使わずに即座に出せる。 */
  /**
   * 閉じる。
   *
   * 書きかけがあるときだけ確認する。何も入れていない人にまで
   * 確認を出すと、閉じるのに2回押させることになる。
   * アップロード中は閉じさせない（途中で消えた投稿が残る）。
   */
  const close = useCallback(() => {
    if (uploading) return

    const leave = () => {
      if (router.canGoBack()) router.back()
      else router.replace('/(tabs)')
    }

    const dirty =
      images.length > 0 || !!caption.trim() || !!locationName.trim() || rating > 0

    if (!dirty) {
      leave()
      return
    }

    Alert.alert(
      '編集中の内容を破棄しますか？',
      '写真や入力した内容は保存されません。',
      [
        { text: '編集を続ける', style: 'cancel' },
        { text: '破棄する', style: 'destructive', onPress: leave },
      ]
    )
  }, [uploading, images.length, caption, locationName, rating, router])

  const areaPreview = pin ? nearestArea(pin.latitude, pin.longitude) : null

  /** 同名のエリアが他県にもあるので、県名を添えて取り違えを防ぐ。 */
  const areaPrefecture = areaPreview
    ? PREFECTURE_BY_ID[areaPreview.area.prefId]?.name ?? null
    : null

  // ★ 店の座標を取りに行っている間は投稿させないこと。
  //   押せてしまうと、取得が終わる前の（＝選ぶ前の）店名と座標で保存される。
  //   投稿の中身が、画面に出ている選択と食い違う形になる。
  const canSubmit =
    images.length > 0 && rating > 0 && !!locationName.trim() && !!pin &&
    !uploading && resolvingPlace === null

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ★ モーダルには戻る矢印が出ない（iOS の仕様）。
            下向きのスワイプで閉じる作りになっているが、この画面は縦に長く、
            スクロールが先に効いてしまう。キーボードが出ていればなお閉じられない。
            閉じる手段が画面に無い状態だったので、ヘッダーに置く。 */}
      <Stack.Screen
        options={{ headerLeft: () => <HeaderClose onPress={close} disabled={uploading} /> }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>

        {/* ── 写真 ─────────────────────────────── */}
        <View style={{ gap: space.sm }}>
          <View style={styles.labelRow}>
            <Txt variant="smallMed" tone="muted">写真</Txt>
            <Txt variant="small" tone="faint">{images.length} / {MAX_IMAGES}（動画は不可）</Txt>
          </View>

          {/* ★ 「追加」の枠は横スクロールの外、左端に固定すること。
                以前は写真の後ろ（右端）に置いていたので、写真を足すたびに枠が右へ逃げ、
                3枚目あたりからはスクロールしないと次を足せなかった。
                5枚そろっても枠は消さない。消すと写真の並びが左へずれるため。
                押せば pickImages が「5枚までです」と案内する。
                写真の順番は変えない（左から1枚目が地図のピンと代表写真に使われる）。 */}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Pressable
              onPress={pickImages}
              accessibilityRole="button"
              accessibilityLabel={images.length < MAX_IMAGES ? '写真を追加' : '写真は5枚までです'}
              style={({ pressed }) => [
                styles.addThumb,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  opacity: images.length >= MAX_IMAGES ? 0.4 : pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="images-outline" size={26} color={colors.textFaint} />
              <Txt variant="caption" tone="faint">追加</Txt>
            </Pressable>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: space.sm }}
          >
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
          </ScrollView>
          </View>
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

          {/* ── 言葉で探す ─────────────────────────
            * 店名でも駅名・地名・住所でも引ける。
            * 店を選ぶと、店名の欄とピンの両方が埋まる。 */}
          <View style={{ gap: space.sm }}>
            <Field
              value={placeQuery}
              onChangeText={(v) => {
                setPlaceQuery(v)
                if (!v.trim()) {
                  setPlaceResults([]); setPlaceSearched(false); setPlaceCapped(false)
                }
              }}
              placeholder="店名・駅名・地名で探す（例: 用心棒）"
              returnKeyType="search"
              onSubmitEditing={runPlaceSearch}
              autoCapitalize="none"
              autoCorrect={false}
              right={
                placeSearching
                  ? <ActivityIndicator size="small" color={colors.textFaint} />
                  : placeQuery.trim().length >= 2
                    ? (
                        <Pressable onPress={runPlaceSearch} hitSlop={8} accessibilityLabel="この言葉で探す">
                          <Ionicons name="search" size={18} color={colors.accent} />
                        </Pressable>
                      )
                    : undefined
              }
            />

            {placeResults.length > 0 && (
              <View style={[styles.results, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                {placeResults.map((hit, i) => (
                  <Pressable
                    // 座標の無い候補（店名）は緯度経度で区別できないので placeId も混ぜる
                    key={`${hit.source}-${hit.placeId ?? ''}-${hit.name}-${hit.latitude}-${hit.longitude}`}
                    onPress={() => choosePlace(hit)}
                    // 取りに行っている間は、ほかの候補も押せなくする。
                    // 押せてしまうと、先に押した店の応答があとから上書きする。
                    disabled={resolvingPlace !== null}
                    style={({ pressed }) => [
                      styles.resultRow,
                      {
                        // 先頭行は囲みの線と重なるので引かない
                        borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        hit.isStore
                          ? 'restaurant-outline'
                          : hit.source === 'local'
                            ? 'navigate-circle-outline'
                            : 'location-outline'
                      }
                      size={18}
                      color={colors.geo}
                    />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed" numberOfLines={1}>{hit.name}</Txt>
                      {!!hit.detail && (
                        <Txt variant="small" tone="faint" numberOfLines={1}>{hit.detail}</Txt>
                      )}
                    </View>
                    {resolvingPlace === hit.placeId && !!hit.placeId && (
                      <ActivityIndicator size="small" color={colors.textFaint} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            {placeSearched && placeResults.length === 0 && !placeSearching && (
              <Txt variant="small" tone="muted">
                見つかりませんでした。店名の一部か、最寄り駅や地名で試してみてください。
              </Txt>
            )}

            {/* 上限に達した日でも、過去にこのアプリへ登録された店と
                地名では引けている。何が起きているかだけ伝える。 */}
            {placeCapped && !placeSearching && (
              <Txt variant="small" tone="muted">
                今日は店名の検索が上限に達しました。これまでに登録された店と、駅名・地名では探せます。
              </Txt>
            )}
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
                onMapReady={onMapReady}
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
  results: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.md, paddingVertical: space.md,
  },
  locationCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
  publicRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.md, borderWidth: 1,
  },
})
