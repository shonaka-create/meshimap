# App Review に出す情報（Guideline 2.1 - Information Needed への回答）

2026-08-14 の審査で、build `1.0.0 (2)` が **Guideline 2.1 - Information Needed - New App Submission**
で却下されました。**不具合の指摘ではありません。** 新規アプリの審査に必要な情報が
App Store Connect の「App Review に関する情報」に入っていなかった、という内容です。

Apple が求めているのは7項目です。

| # | 求められたもの | どこで用意するか |
|---|---|---|
| 1 | 実機で撮った画面収録（起動から主要機能まで） | 下の「撮影台本」 |
| 2 | テストした端末とOSの一覧 | 下の英文（**要記入**） |
| 3 | アプリの機能・対象ユーザー・解決する課題 | 下の英文 |
| 4 | 主要機能への到達手順とログイン情報 | 下の英文 |
| 5 | 使っている外部サービス | 下の英文 |
| 6 | 地域による違いの有無 | 下の英文 |
| 7 | 規制業種か / 第三者の権利物を含むか | 下の英文 |

> Apple は「**今後の提出のために Notes 欄に入れておくこと**」と書いています。
> Resolution Center に返信するだけでなく、
> App Store Connect > App Review に関する情報 > **メモ（Notes）** にも同じ文を貼ってください。

---

## ★ 最優先: サインイン情報が偽アドレスになっている

2026-08-25 時点で、App Store Connect の「App Review に関する情報 > サインイン情報」は

```
admin@examlpe.com  /  Abcd1234!!
```

でした。`examlpe` は `example` の打ち間違いで、**このアカウントは存在しません。**
つまり審査担当はアプリにログインできず、中身を一切見られていません。
Apple の返信にある *"provide up-to-date login credentials for a demo account"* は
これを指しています。**ここを直さないと、何を送っても同じ却下になります。**

実際にログインできることを確認済みのアカウント（2026-08-25 に検証）:

| メールアドレス | パスワード | 中身 |
|---|---|---|
| `teardoro+taro@gmail.com` | `.env.local` の `SEED_PASSWORD` | @taro / 田中太郎 / 投稿15件 |

> 他のデモ用ユーザー（hanako / kenji / yuki / yamada / ebisu / admin）は、
> 同じパスワードではログインできませんでした。**審査には taro を使ってください。**
> 増やしたい場合は `npm run seed` を流し直すか、パスワードを揃え直す必要があります。

---

## そのまま貼る英文

> ⚠ **Resolution Center の返信欄と Notes 欄は 4000 文字までです。**
> 下の全文（約6,600字）はそのままだと入りません。
> 縮めた版を `app-review/review-reply-short-en.txt`（約3,900字）に置いてあるので、
> **貼るのはそちら**。下の全文は元資料として残してあります。

そのままコピーして使えます（端末は iPhone 17 / iOS 26.5.2 で記入済み）。
審査担当は英語で書いてきているので、英語で返します。

パスワードはこの文には入れていません。「サインイン情報」の欄に入っているので、
同じものを2箇所に書かなくて済みます。

```text
DEMO ACCOUNT (the app is account-based; nothing is visible without signing in)

The credentials are in the Sign-In Information fields of this same App Review Information
section (e-mail: teardoro+taro@gmail.com). There is only one type of account, so that
single account is enough to reach every feature of the app.

--------------------------------------------------------------------------------
1. WHAT THE APP DOES, AND WHO IT IS FOR

MeshiMap is a personal record of restaurants you have actually eaten at, shown on a map.
You photograph the restaurant, rate it, and the post is placed on the map of Japan.
The map is browsed by drilling down: prefecture -> area (a major station or downtown
district) -> the individual posts in that area.

Your own icon, and the icons of the people you follow, are placed at "the last restaurant
you posted", NOT at your live location. We never store or share a live position.

The problem it solves: deciding where to eat. Reviews written by strangers are hard to
trust, and search results are dominated by paid listings. MeshiMap only shows places that
you, or someone you chose to follow, actually went to. The "Today, where?" tab lets you
choose an occasion (a date, eating alone, an anniversary), a budget and a genre, and
proposes places from those posts.

Target audience: people in Japan, roughly in their 20s to 40s, who eat out often, want to
keep a record of where they have been, and want to see where their friends have been.

--------------------------------------------------------------------------------
2. DEVICES AND OPERATING SYSTEMS TESTED BEFORE SUBMISSION

  - iPhone 17, iOS 26.5.2  (physical device, installed via TestFlight)

The app is built with Expo SDK 54 / React Native 0.81. Minimum supported iOS version is
iOS 15.1. iPad is not supported (iPhone only).

--------------------------------------------------------------------------------
3. HOW TO SET UP AND REACH THE MAIN FEATURES

 1. Launch the app and tap "ログイン" (Log in). Sign in with the demo account above.
    New registration is on the same screen ("新規登録"): it asks for a display name, a
    user ID, an e-mail address, a password, and agreement to the Terms of Use.
 2. MAP (first tab). Each bubble shows the number of posts in that region. Tap a bubble
    to go one level down (prefecture -> area). At the area level, individual restaurant
    pins appear; tap a pin for a preview, then tap the preview to open the full post.
 3. WHOSE MAP TO SHOW. The button at the bottom left ("他の人の地図") opens a drawer that
    selects whose posts appear as icons on the map.
 4. CREATE A POST ("+" tab). Choose up to 5 photos from the photo library, give a rating,
    a genre, a budget, an occasion, a caption, and the location.
    NEW POSTS ARE PRIVATE BY DEFAULT. To publish one, open your profile and tap the lock
    badge on the thumbnail.
 5. RECOMMENDATIONS ("今日どこ行く？" tab). Choose conditions, then tap the button at the
    bottom.
 6. SEARCH tab. Searches both restaurants and accounts.
 7. PROFILE tab. Your posts, your rank, and Settings.
 8. REPORTING AND BLOCKING (user-generated content). Open any post by another user and
    tap the flag icon at the top right, or open another user's profile and use
    "通報" (report) or "ブロック" (block). Blocking hides both users from each other.
 9. DELETING YOUR OWN CONTENT. Open your profile, tap one of your photos, then tap the
    trash icon at the top right.
10. DELETING YOUR ACCOUNT. Profile tab -> 設定 (Settings) -> "アカウントを削除"
    (Delete account). This removes the account and all of its posts and photos.

--------------------------------------------------------------------------------
4. PAID CONTENT AND SUBSCRIPTIONS

This build contains NO in-app purchases. No StoreKit products are configured for this app,
no prices are shown anywhere, and no purchase or subscription screen can be reached.

Some lists are limited in length (the monthly ranking, and the "featured" list). Where a
paid plan would eventually be offered, this build only states how many entries are
currently being shown, and offers nothing to buy.

--------------------------------------------------------------------------------
5. EXTERNAL SERVICES, TOOLS AND PLATFORMS

  - Supabase (PostgreSQL database, authentication, file storage)
      Accounts, posts, and photos. E-mail + password sign-in.
  - Google Maps SDK for iOS
      Rendering the map.
  - Google Geocoding API
      Turning the coordinates of a post into a prefecture and city name. It is called from
      our own server, never from the app. The app first uses built-in coordinate data for
      Japan's 47 prefectures and 144 major areas, so in most cases it is not called at all.
  - Expo / EAS (Expo Application Services)
      Building and distributing the app.

There are no AI services, no payment processors, no advertising SDKs, and no analytics or
attribution SDKs. The app does not track users and therefore does not use App Tracking
Transparency.

--------------------------------------------------------------------------------
6. REGIONAL DIFFERENCES

There are none. No feature or content is enabled or disabled based on region.

The interface is currently available in Japanese only, and the built-in area data covers
Japan, so the map is most useful in Japan. The app itself behaves identically everywhere.

--------------------------------------------------------------------------------
7. REGULATED INDUSTRY / THIRD-PARTY MATERIAL

The app does not operate in a regulated industry.

The sample content that ships with the app was created by us for demonstration purposes.
It uses photographs licensed under the Unsplash License, together with the names of real
restaurants. Every such account is flagged in our database, and the app displays a visible
"デモ" (demo) notice on the profile and on each of those posts, so that demonstration
content cannot be mistaken for a genuine customer review. Posts made by real users carry
no such notice.

--------------------------------------------------------------------------------
8. PERMISSIONS REQUESTED, AND WHY

  - Location, When In Use only.
      Used to center the map on the user, and for the "return to my location" button.
      The location is used at the moment the button is pressed and is never stored or
      shared. Map icons are placed at the last restaurant a user posted, not at their
      live position. The app never requests Always location.
  - Photo Library.
      To choose the photos attached to a post, and the profile picture.

The app never opens the camera or the microphone and does not declare those permissions.
```

---

## 撮影台本（項目1の画面収録）

**実機**で、**最新のiOS**で、**アプリの起動から**撮ってください（起動の瞬間が映っていないと差し戻されます）。
iPhone の画面収録機能（コントロールセンター）で構いません。3〜5分が目安です。

Apple が「入っていたら必ず映せ」と言っているものに ★ を付けています。

| # | 撮るもの | 注意 |
|---|---|---|
| 1 | ホーム画面のアイコンをタップして**起動** | ここから撮り始める |
| 2 | ★ **新規登録**（捨てアカウントを作る） | 規約チェック → 登録まで |
| 3 | ★ **位置情報の許可ダイアログ**が出るところ | 「許可」を押す |
| 4 | 地図: 全国 → 県 → エリア → ピン → 投稿詳細 | ドリルダウンが分かるように |
| 5 | ★ **写真ライブラリの許可ダイアログ** → 投稿作成 | 「+」タブ。写真選択〜投稿まで |
| 6 | プロフィールで、いま作った投稿を**公開に切り替え** | 鍵バッジをタップ |
| 7 | ★ **通報**（他人の投稿 → 右上の旗 → 理由選択 → 送信） | UGCの必須要件 |
| 8 | ★ **ブロック**（他人のプロフィール → ブロック） | 同上 |
| 9 | 自分の投稿を**削除**（右上のゴミ箱） | |
| 10 | ★ **アカウント削除**（設定 → アカウントを削除） | 2で作った捨てアカウントを消す |
| 11 | ★ デモアカウントで**ログイン**し直す | 3で消えているので |
| 12 | 「今日どこ行く？」で条件を選んで結果を出す | 主要機能なので入れておく |

> **有料機能は「無い」ことを映す**のが正解です。この版では購入画面に到達できません。
> 上の英文の 4 章でその旨を明記してあるので、無理に何かを映す必要はありません。

> ★ 2 の新規登録で「確認メールを送りました」で止まる場合は、Supabase のメール確認が
> 有効になっています。その画面まで映してから、11 のデモアカウントログインに進めば問題ありません。
> （気になる場合は Supabase の Authentication 設定で確認してください。）

動画は Resolution Center の返信に**添付**します。サイズが大きくて添付できないときは、
限定公開の共有リンク（YouTube 限定公開 / Google Drive のリンク共有）を本文に貼ってください。

---

## App Store Connect での操作手順

1. **返信する**
   App > 配信 > 左サイドバー **App Review** > メッセージ > 返信
   → 上の英文を貼り、画面収録を添付して送信

2. **Notes 欄にも入れる**（Apple が「今後のために」と指定）
   App > 配信 > **App Review に関する情報** > メモ（Notes）に同じ英文を貼る
   同じ画面の**サインイン情報**（デモアカウントのメール/パスワード）が埋まっているかも確認する

3. **新しいビルドに差し替える**
   App > 配信 > iOSアプリ 1.0 > ビルド > 「ビルドを選択」 → **1.0.0 (11)** を選ぶ → 保存

4. **再提出**
   右上の「審査内容を更新」/「審査へ提出」

> バージョンは **1.0 のままで構いません**（却下済み＝未リリースなので、番号を上げる必要はない）。
