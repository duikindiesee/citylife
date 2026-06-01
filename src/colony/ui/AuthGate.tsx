import { useMemo, useState, type ReactNode } from 'react'
import { AuthClient } from '../authClient'
import { LoginScreen } from './LoginScreen'

/** Gates its children behind operator login. Renders the LoginScreen until authenticated. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useMemo(() => new AuthClient(), [])
  // Auto-login in dev when .env.local provides VITE_OPERATOR_NAME + VITE_OPERATOR_PASSCODE.
  const [authed, setAuthed] = useState(() => auth.isAuthenticated || auth.tryAutoLogin())
  if (!authed) return <LoginScreen auth={auth} onAuthed={() => setAuthed(true)} />
  return <>{children}</>
}
