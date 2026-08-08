import { View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTheme } from '../../src/theme'
import { ProfileView } from '../../src/components/ProfileView'

/**
 * 他人のプロフィールページ。
 * Fav タブや検索結果から直接ここへ来る（自分のプロフィールタブは経由しない）。
 */
export default function UserProfile() {
  const { username } = useLocalSearchParams<{ username: string }>()
  const { colors } = useTheme()

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: username ? `@${username}` : '' }} />
      {username && <ProfileView username={username} />}
    </View>
  )
}
