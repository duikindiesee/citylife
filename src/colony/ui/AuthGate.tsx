import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { getAuthClient } from '../authClient'
import { LoginScreen } from './LoginScreen'

/** Gates its children behind operator login. Renders the LoginScreen until authenticated.
 *  On mount, tries a dev auto-login (async — reads VITE_OPERATOR_EMAIL + VITE_OPERATOR_PASSWORD
 *  from the gitignored .env.local and hits the kooker auth service). Shows nothing during that
 *  brief check so there's no login flash when auto-login is configured. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useMemo(() => getAuthClient(), [])
  const [authed, setAuthed] = useState(auth.isAuthenticated)
  const [checking, setChecking] = useState(!auth.isAuthenticated)

  useEffect(() => {
    if (auth.isAuthenticated) {
      setChecking(false)
      return
    }
    auth.tryAutoLogin().then((ok) => {
      if (ok) setAuthed(true)
      setChecking(false)
    })
  }, [auth])

  if (checking) return null
  if (!authed) return <LoginScreen auth={auth} onAuthed={() => setAuthed(true)} />
  return <>{children}</>
}
