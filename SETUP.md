# MeshiMap セットアップガイド

## 1. Firebase プロジェクトの作成

1. [Firebase Console](https://console.firebase.google.com/) にアクセス
2. 「プロジェクトを作成」をクリック → プロジェクト名: `meshimap`
3. Google アナリティクスは任意

## 2. Firebase サービスの有効化

### Authentication
- Firebase Console → Authentication → 「始める」
- Sign-in providers で以下を有効化:
  - **メール/パスワード** → 有効にする
  - **Google** → 有効にする（プロジェクトのサポートメールを設定）

### Firestore Database
- Firebase Console → Firestore Database → 「データベースの作成」
- 本番環境モードで開始
- ロケーション: `asia-northeast1`（東京）

### Storage
- Firebase Console → Storage → 「始める」
- デフォルト設定でOK

## 3. Firebase 設定キーの取得

1. Firebase Console → プロジェクト設定（歯車アイコン）
2. 「マイアプリ」→ ウェブアプリ「</>」を追加
3. アプリ名: `meshimap-web`
4. 表示された設定をコピー

## 4. 環境変数の設定

`.env.local` ファイルを編集して Firebase の値を入力:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=meshimap.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=meshimap
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=meshimap.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
```

## 5. Firestore セキュリティルールの適用

Firebase Console → Firestore → 「ルール」タブ → `firestore.rules` の内容をコピーして貼り付け → 「公開」

## 6. Firestore インデックスの作成

以下のインデックスを作成（Firebase Console → Firestore → インデックス）:

| コレクション | フィールド1 | フィールド2 |
|---|---|---|
| posts | userId (昇順) | createdAt (降順) |
| posts | hashtags (配列) | createdAt (降順) |
| chats | participants (配列) | lastMessageAt (降順) |

## 7. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開く

## 8. Vercel へのデプロイ

```bash
npm install -g vercel
vercel
```

環境変数を Vercel のダッシュボードで設定してください。
