-- ============================================================
-- MeshiMap - Supabase Schema
-- Supabase SQL Editor にこのファイルをそのまま貼り付けて実行
-- ============================================================

-- 1. プロフィール（auth.users を拡張）
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  display_name  TEXT NOT NULL DEFAULT '名無し',
  photo_url     TEXT,
  bio           TEXT DEFAULT '',
  followers_count INT DEFAULT 0,
  following_count INT DEFAULT 0,
  posts_count   INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 投稿
CREATE TABLE IF NOT EXISTS posts (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  caption       TEXT DEFAULT '',
  rating        INT CHECK (rating >= 1 AND rating <= 5) NOT NULL,
  genre         TEXT NOT NULL,
  price_range   TEXT NOT NULL,
  location_name TEXT NOT NULL,
  location_lat  DOUBLE PRECISION NOT NULL,
  location_lng  DOUBLE PRECISION NOT NULL,
  hashtags      TEXT[] DEFAULT '{}',
  likes_count   INT DEFAULT 0,
  comments_count INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 投稿画像（複数枚対応）
CREATE TABLE IF NOT EXISTS post_images (
  id       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id  UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  url      TEXT NOT NULL,
  position INT DEFAULT 0
);

-- 4. いいね
CREATE TABLE IF NOT EXISTS likes (
  user_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  post_id  UUID REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

-- 5. コメント
CREATE TABLE IF NOT EXISTS comments (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id    UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. フォロー
CREATE TABLE IF NOT EXISTS follows (
  follower_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- 7. チャット
CREATE TABLE IF NOT EXISTS chats (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  last_message    TEXT DEFAULT '',
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. チャット参加者
CREATE TABLE IF NOT EXISTS chat_participants (
  chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, user_id)
);

-- 9. メッセージ
CREATE TABLE IF NOT EXISTS messages (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id    UUID REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  sender_id  UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Storage バケット（Supabase Dashboard > Storage で作成も可）
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', true)
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS (Row Level Security) ポリシー
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "誰でも閲覧可" ON profiles FOR SELECT USING (true);
CREATE POLICY "本人のみ更新可" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "本人のみ挿入可" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- posts
CREATE POLICY "誰でも閲覧可" ON posts FOR SELECT USING (true);
CREATE POLICY "本人のみ投稿可" ON posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "本人のみ更新可" ON posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "本人のみ削除可" ON posts FOR DELETE USING (auth.uid() = user_id);

-- post_images
CREATE POLICY "誰でも閲覧可" ON post_images FOR SELECT USING (true);
CREATE POLICY "認証ユーザーのみ挿入可" ON post_images FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "認証ユーザーのみ削除可" ON post_images FOR DELETE USING (auth.uid() IS NOT NULL);

-- likes
CREATE POLICY "誰でも閲覧可" ON likes FOR SELECT USING (true);
CREATE POLICY "本人のみ操作可" ON likes FOR ALL USING (auth.uid() = user_id);

-- comments
CREATE POLICY "誰でも閲覧可" ON comments FOR SELECT USING (true);
CREATE POLICY "認証ユーザーのみ投稿可" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "本人のみ削除可" ON comments FOR DELETE USING (auth.uid() = user_id);

-- follows
CREATE POLICY "誰でも閲覧可" ON follows FOR SELECT USING (true);
CREATE POLICY "本人のみ操作可" ON follows FOR ALL USING (auth.uid() = follower_id);

-- chats & participants & messages（参加者のみ）
CREATE POLICY "参加者のみ閲覧可" ON chats FOR SELECT
  USING (EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = chats.id AND user_id = auth.uid()));
CREATE POLICY "認証ユーザーのみ作成可" ON chats FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "参加者のみ更新可" ON chats FOR UPDATE
  USING (EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = chats.id AND user_id = auth.uid()));

CREATE POLICY "誰でも閲覧可" ON chat_participants FOR SELECT USING (true);
CREATE POLICY "認証ユーザーのみ挿入可" ON chat_participants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "参加者のみ閲覧可" ON messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = messages.chat_id AND user_id = auth.uid()));
CREATE POLICY "本人のみ送信可" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Storage ポリシー
CREATE POLICY "誰でも閲覧可" ON storage.objects FOR SELECT USING (bucket_id IN ('post-images', 'avatars'));
CREATE POLICY "認証ユーザーのみアップロード可" ON storage.objects FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND bucket_id IN ('post-images', 'avatars'));
CREATE POLICY "本人のみ削除可" ON storage.objects FOR DELETE
  USING (auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- トリガー: 新規ユーザー登録時にプロフィールを自動作成
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, photo_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
