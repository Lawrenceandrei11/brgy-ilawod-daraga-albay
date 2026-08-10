import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const STAFF_ROLES = ['secretary', 'treasurer', 'captain']

export function AuthProvider({ children }) {
  // `undefined` means "still checking" — distinct from `null`, which means
  // "definitely signed out". Route guards must not redirect during the check,
  // or a signed-in resident gets bounced to the login page on every refresh.
  const [session, setSession] = useState(undefined)
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next ?? null)
      if (event === 'SIGNED_OUT') queryClient.clear()
      if (event === 'SIGNED_IN') queryClient.invalidateQueries({ queryKey: ['profile'] })
    })

    return () => subscription.unsubscribe()
  }, [queryClient])

  const userId = session?.user?.id ?? null

  const {
    data: profile,
    isLoading: profileLoading,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const value = useMemo(() => {
    const role = profile?.role ?? null
    return {
      session,
      user: session?.user ?? null,
      profile: profile ?? null,

      // Still resolving either the session or the profile behind it.
      loading: session === undefined || (!!userId && profileLoading),
      signedIn: !!session,

      role,
      isStaff: STAFF_ROLES.includes(role),
      isCaptain: role === 'captain',
      isResident: role === 'resident',

      // Approved is the gate for filing anything. A pending resident can sign
      // in and look around, but cannot transact — which is what the prototype
      // shows, and what lets them watch their own approval progress.
      isApproved: profile?.status === 'approved',
      status: profile?.status ?? null,

      refetchProfile,
      signOut: () => supabase.auth.signOut(),
    }
  }, [session, profile, profileLoading, userId, refetchProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
