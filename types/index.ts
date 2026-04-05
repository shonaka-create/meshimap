export interface User {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  bio?: string
  followersCount: number
  followingCount: number
  postsCount: number
  createdAt: Date
}

export interface Post {
  id: string
  userId: string
  userDisplayName: string
  userPhotoURL: string | null
  imageURLs: string[]
  caption: string
  rating: number
  genre: FoodGenre
  priceRange: PriceRange
  location: {
    name: string
    lat: number
    lng: number
  }
  hashtags: string[]
  likesCount: number
  commentsCount: number
  createdAt: Date
}

export interface Comment {
  id: string
  postId: string
  userId: string
  userDisplayName: string
  userPhotoURL: string | null
  text: string
  createdAt: Date
}

export interface Like {
  userId: string
  postId: string
  createdAt: Date
}

export interface Follow {
  followerId: string
  followingId: string
  createdAt: Date
}

export interface Message {
  id: string
  chatId: string
  senderId: string
  senderDisplayName: string
  senderPhotoURL: string | null
  text: string
  createdAt: Date
}

export interface Chat {
  id: string
  participants: string[]
  participantDetails: {
    [uid: string]: {
      displayName: string
      photoURL: string | null
    }
  }
  lastMessage: string
  lastMessageAt: Date
  unreadCount?: number
}

export type FoodGenre =
  | '和食'
  | '洋食'
  | 'イタリアン'
  | 'フレンチ'
  | '中華'
  | '韓国料理'
  | 'アジア料理'
  | 'カフェ'
  | 'ラーメン'
  | '寿司'
  | '焼肉'
  | 'スイーツ'
  | 'その他'

export type PriceRange = '〜¥1,000' | '¥1,001〜¥3,000' | '¥3,001〜¥5,000' | '¥5,001〜¥10,000' | '¥10,001〜'
