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

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '近くのお店を地図に表示するために現在地を利用します。',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '投稿する料理の写真を選ぶためにフォトライブラリへアクセスします。',
        cameraPermission: '料理の写真を撮影するためにカメラを使用します。',
      },
    ],
  ],

  experiments: { typedRoutes: true },

  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // Geocoding API（逆ジオコーディング）用。iOS SDK キーとは別物にしてよい。
    googleGeocodingKey: process.env.EXPO_PUBLIC_GOOGLE_GEOCODING_KEY,
  },
}

export default config
