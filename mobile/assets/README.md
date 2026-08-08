# assets

`app.config.ts` が以下のファイルを参照しています。**未配置だと `expo prebuild` が失敗します。**

| ファイル | サイズ | 要件 |
|---|---|---|
| `icon.png` | **1024×1024** | 角丸を自分で付けない。**透過（アルファチャンネル）を含めない** — 含むと App Store 審査で弾かれます |
| `splash.png` | 1284×2778 推奨 | 起動画面。中央に置いたロゴが `resizeMode: contain` で収まる想定 |
| `adaptive-icon.png` | 1024×1024 | Android 用。iOS のみで出すなら不要（その場合は `app.config.ts` の `android.adaptiveIcon` を削除） |

背景色は `#FBF8F4`（テーマの `colors.bg`）に合わせるとスプラッシュの継ぎ目が出ません。
