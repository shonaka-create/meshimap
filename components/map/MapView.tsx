'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Post } from '@/types'
import { Star } from 'lucide-react'
import Link from 'next/link'
import { GENRE_META } from '@/lib/genreMeta'

function FlyToController({ flyTo }: { flyTo?: { pos: [number, number]; key: number } }) {
  const map = useMap()
  useEffect(() => {
    if (flyTo) map.flyTo(flyTo.pos, 16, { duration: 1.2 })
  }, [flyTo, map])
  return null
}

// タブ非表示 → 復帰時にタイルが白くなる Leaflet の既知問題を解消する。
// ブラウザが非アクティブタブのレイアウト計算を止めるため、
// visibilitychange で visible になった瞬間に invalidateSize() を呼ぶ。
function InvalidateSizeOnVisible() {
  const map = useMap()
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => map.invalidateSize(), 100)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [map])
  return null
}

export { GENRE_META }

const createFoodIcon = (genre: string) => {
  const meta = GENRE_META[genre] ?? GENRE_META['その他']
  return L.divIcon({
    className: '',
    html: `
      <div style="
        display:flex;
        flex-direction:column;
        align-items:center;
        filter: drop-shadow(0 2px 6px rgba(0,0,0,0.25));
      ">
        <div style="
          width:44px;height:44px;
          border-radius:50% 50% 50% 4px;
          background:${meta.bg};
          border:3px solid ${meta.border};
          display:flex;align-items:center;justify-content:center;
          font-size:22px;
          transform:rotate(-45deg);
        ">
          <span style="transform:rotate(45deg); display:block;">${meta.emoji}</span>
        </div>
      </div>
    `,
    iconSize: [44, 52],
    iconAnchor: [22, 52],
    popupAnchor: [0, -54],
  })
}

interface MapViewProps {
  posts: Post[]
  center?: [number, number]
  zoom?: number
  flyTo?: { pos: [number, number]; key: number }
}

export default function MapView({ posts, center = [35.6812, 139.7671], zoom = 12, flyTo }: MapViewProps) {
  return (
    <MapContainer center={center} zoom={zoom} style={{ width: '100%', height: '100%' }}>
      <FlyToController flyTo={flyTo} />
      <InvalidateSizeOnVisible />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {posts.map((post) => (
        <Marker
          key={post.id}
          position={[post.location.lat, post.location.lng]}
          icon={createFoodIcon(post.genre)}
        >
          <Popup>
            <div className="w-52 font-sans">
              {post.imageURLs[0] && (
                <img src={post.imageURLs[0]} alt="" className="w-full h-28 object-cover rounded-lg mb-2" />
              )}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-lg">{GENRE_META[post.genre]?.emoji ?? '🍴'}</span>
                <p className="font-semibold text-sm truncate">{post.location.name}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: GENRE_META[post.genre]?.bg, color: GENRE_META[post.genre]?.border, border: `1px solid ${GENRE_META[post.genre]?.border}` }}>
                  {post.genre}
                </span>
                <div className="flex items-center gap-0.5">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  <span className="text-xs font-semibold">{post.rating}.0</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">{post.priceRange}</p>
              {post.caption && <p className="text-xs text-gray-700 mt-1 line-clamp-2">{post.caption}</p>}
              <Link href={`/profile/${post.userId}`} className="text-xs text-blue-500 mt-1.5 block font-medium">
                @{post.userDisplayName} →
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
