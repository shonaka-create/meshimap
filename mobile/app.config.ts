import type { ExpoConfig } from 'expo/config'

/**
 * app.json ではなく app.config.ts を使う理由:
 * Google Maps の iOS キーを設定ファイルに直書きするとリポジトリに載ってしまう。
 * ここで process.env 経由にすることで、鍵は .env（Git対象外）だけに存在する。
 */
const config: ExpoConfig = {
  name: 'MeshiMap',
  slug: 'meshimap',
  version: '1.0.0',
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

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.shonaka.meshimap',
    buildNumber: '1',
    config: {
      // iOS の react-native-maps が使う Google Maps SDK キー
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
    },
    infoPlist: {
      // 位置情報: 「現在地を表示」「現在地に戻る」ボタンのため
      NSLocationWhenInUseUsageDescription:
        '近くのお店を地図に表示し、現在地に戻るボタンを使うために位置情報を利用します。',
      // 写真: 投稿画像の選択のため
      NSPhotoLibraryUsageDescription:
        '投稿する料理の写真を選ぶためにフォトライブラリへアクセスします。',
      NSCameraUsageDescription:
        '料理の写真をその場で撮影して投稿するためにカメラを使用します。',
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: 'com.shonaka.meshimap',
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
        cameraPermission: '料理の写真を撮影するためにカメラを使用します。',
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
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // 逆ジオコーディングを頼む先。Vercel に公開した Web の URL。
    // 未設定でも投稿は止まらない（内蔵の地域データだけで判定する）。
    webUrl: process.env.EXPO_PUBLIC_WEB_URL,
  },
}

export default config
