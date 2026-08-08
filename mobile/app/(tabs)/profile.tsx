import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../../src/hooks/useAuth'
import { useTheme } from '../../src/theme'
import { Loading } from '../../src/components/ui'
import { ProfileView } from '../../src/components/ProfileView'

export default function MyProfile() {
  const { user } = useAuth()
  const { colors } = useTheme()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {user ? (
        <ProfileView selfId={user.id} />
      ) : (
        <View style={{ flex: 1 }}>
          <Loading />
        </View>
      )}
    </SafeAreaView>
  )
}
