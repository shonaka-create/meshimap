import type { ExpoConfig } from 'expo/config'

/**
 * app.json ではなく app.config.ts を使う理由:
 * Google Maps の iOS キーを設定ファイルに直書きするとリポジトリに載ってしまう。
 * ここで process.env 経由にすることで、鍵は .env（Git対象外）だけに存在する。
 */
const config: ExpoConfig = {
  name: 'MeshiMap',
  slug: 'meshimap',
  // Expo アカウントを2つ持っているので、どちらのものかを明示しておく
  owner: 'shonakacreate',
  version: '1.0.2',
  orientation: 'portrait',
  scheme: 'meshimap',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icon.png',

  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#FBF8F4',
  },

  /**
   * App Store の商品ページに出る「言語」欄は、ASC の入力ではなく
   * バイナリに入っている .lproj で決まる。ここで日本語を宣言しないと
   * 既定の英語のまま「EN English」と表示される。
   * CFBundleDevelopmentRegion（下の infoPlist）と対で効く。
   */
  locales: {
    ja: './locales/ja.json',
  },

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'jp.yournist.meshimap',
    /**
     * ★ production ビルドでは、この値は使われない。
     *   eas.json が appVersionSource: "remote" ＋ autoIncrement: true なので、
     *   ビルド番号は EAS のサーバー側が持っていて、ビルドのたびに +1 される。
     *   ここを手で上げる必要は無い（上げても反映されない）。
     *   提出ごとに上げるのは、上の version（表示用）のほう。
     */
    buildNumber: '1',
    config: {
      // iOS の react-native-maps が使う Google Maps SDK キー
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
    },
    infoPlist: {
      // 既定の言語。これを en のままにすると App Store の言語欄に
      // 英語が併記される。locales の ja と対で設定すること。
      CFBundleDevelopmentRegion: 'ja',
      // 位置情報: 「現在地を表示」「現在地に戻る」ボタンのため
      NSLocationWhenInUseUsageDescription:
        '近くのお店を地図に表示し、現在地に戻るボタンを使うために位置情報を利用します。',
      // 写真: 投稿画像の選択のため
      NSPhotoLibraryUsageDescription:
        '投稿する料理の写真を選ぶためにフォトライブラリへアクセスします。',
      // ★ NSCameraUsageDescription は書かない。
      //   このアプリはカメラを一度も起動しない。投稿もアイコンも
      //   launchImageLibraryAsync だけで、launchCameraAsync の
      //   呼び出しはコード中に1つも無い。
      //   使わない権限を宣言すると審査で必ず用途を聞かれる。
      //   撮影機能を足すときは、ここと expo-image-picker の
      //   cameraPermission、check-ios-config.mjs の3箇所を戻すこと。
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'jp.yournist.meshimap',
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FBF8F4',
    },
    config: {
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY },
    },
  },

  /**
   * ★ 使わない権限は「消す」こと。
   *
   *   各プラグインは、指定しないと英語の既定文言つきで
   *   権限の説明を Info.plist に足してくる。放っておくと
   *   このアプリは以下を要求していることになっていた:
   *
   *     NSMicrophoneUsageDescription              … マイク（使っていない）
   *     NSLocationAlwaysUsageDescription          … 常時位置情報（使っていない）
   *     NSLocationAlwaysAndWhenInUseUsageDescription
   *     NSFaceIDUsageDescription                  … Face ID（使っていない）
   *
   *   常時位置情報は審査でとくに厳しく見られるうえ、
   *   App Store のプライバシー表示とも食い違う。
   *   マイクや Face ID も「何に使うのか」を必ず聞かれる。
   *   使っていない権限を消しておくのがいちばん早い。
   *
   *   false を渡すとキー自体が出力されない。
   *   npx expo config --type introspect で結果を確認できる。
   */
  plugins: [
    'expo-router',
    [
      'expo-secure-store',
      {
        // 生体認証は使っていない（セッションの保管にしか使っていない）
        faceIDPermission: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '近くのお店を地図に表示するために現在地を利用します。',
        // 常時取得はしない。現在地は押したときに1回取るだけで、保存もしない。
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '投稿する料理の写真を選ぶためにフォトライブラリへアクセスします。',
        // カメラは起動しない。写真はライブラリからしか選べない。
        cameraPermission: false,
        // 動画を撮らないのでマイクは要らない
        microphonePermission: false,
      },
    ],
  ],

  experiments: { typedRoutes: true },

  /**
   * ★ extra に入れた値は配布物の中に入る。取り出せる前提で選ぶこと。
   *
   *   ここにあってよいのは、露出しても守る手段があるものだけ。
   *   Supabase の anon キーは RLS で守れるので置いてよい。
   *
   *   Google Geocoding の鍵はここに置いてはいけない。
   *   Geocoding は「ウェブサービス API」で、HTTP リファラ制限も
   *   バンドルID制限も効かないため、抜かれたあと請求を止められない。
   *   鍵はサーバー（Web の /api/geocode）にだけ置き、
   *   アプリはログイン済みトークンを添えてそこへ問い合わせる。
   *
   *   Maps SDK の鍵（ios.config.googleMapsApiKey）は事情が違う。
   *   あちらはバンドルIDで縛れるので、アプリに入っていてよい。
   */
  extra: {
    // EAS のプロジェクト識別子。app.config.ts は動的設定のため
    // eas init が書き込めない。手で入れる必要がある。
    eas: { projectId: '6801e263-f159-4633-a363-9eff0da18261' },

    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // 逆ジオコーディングを頼む先。Vercel に公開した Web の URL。
    // 未設定でも投稿は止まらない（内蔵の地域データだけで判定する）。
    webUrl: process.env.EXPO_PUBLIC_WEB_URL,
  },
}

export default config
