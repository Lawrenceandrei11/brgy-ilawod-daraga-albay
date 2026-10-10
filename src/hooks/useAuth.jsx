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

  // True only between a PASSWORD_RECOVERY event and the next sign-out.
  //
  // The reset form requires this, so an ordinary signed-in session is not
  // enough to set a new password. Without it, anyone at an unattended signed-in
  // screen could open /reset-password and take over the account, while the
  // Change Password form on the admin profile deliberately asks for the
  // current password first.
  //
  // Kept in memory on purpose. A reload loses it and the resident is asked for
  // a fresh link, which is the safe direction to fail; persisting it would hand
  // the flag straight back to whoever reopened the tab.
  //
  // This is a session-hygiene gate, not a security boundary. The boundary is
  // Supabase Auth itself: updateUser only ever touches the account behind the
  // calling session, and no client-side flag widens or narrows that.
  const [recoveryMode, setRecoveryMode] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next ?? null)

      // auth-js emits PASSWORD_RECOVERY from a setTimeout that it schedules
      // after initialize() has resolved, so this subscription — registered
      // while React mounts, long before the token exchange returns — is always
      // in place to receive it. For a recovery link it fires *instead of*
      // SIGNED_IN, not alongside it.
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)

      if (event === 'SIGNED_OUT') {
        setRecoveryMode(false)
        queryClient.clear()
      }
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

      // The session check alone, with no profile query folded in. A screen that
      // needs nothing more than "is there a session yet" — the password reset
      // form — waits on this instead, rather than stalling behind a profile
      // fetch it never reads.
      sessionLoading: session === undefined,

      signedIn: !!session,
      recoveryMode,

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
  }, [session, profile, profileLoading, userId, recoveryMode, refetchProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
