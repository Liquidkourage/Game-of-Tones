import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setHostJwt } from '../utils/hostFetch';

/** Same-origin relative path only (no open redirects). */
function isSafePostAuthDest(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const s = raw.trim();
  if (!s.startsWith('/')) return false;
  if (s.startsWith('//')) return false;
  if (s.includes('://')) return false;
  return true;
}

/**
 * Server redirects here after Google OAuth with ?token=…&userId=…
 * Stores JWT for host API + socket auth, then navigates to a saved return path or host-friendly home.
 */
const CallbackGoogle: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setHostJwt(token);
    }
    let dest = '/?mode=host';
    try {
      const ret = sessionStorage.getItem('tempo_post_auth_return')?.trim();
      if (isSafePostAuthDest(ret)) {
        dest = ret;
        sessionStorage.removeItem('tempo_post_auth_return');
      }
    } catch {
      /* ignore */
    }
    navigate(dest, { replace: true });
  }, [navigate, searchParams]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#ccc' }}>
      Finishing sign-in…
    </div>
  );
};

export default CallbackGoogle;
