import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setHostJwt } from '../utils/hostFetch';

/**
 * Server redirects here after Google OAuth with ?token=…&userId=…
 * Stores JWT for host API + socket auth, then returns home.
 */
const CallbackGoogle: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      setHostJwt(token);
    }
    navigate('/', { replace: true });
  }, [navigate, searchParams]);

  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: '#ccc' }}>
      Finishing sign-in…
    </div>
  );
};

export default CallbackGoogle;
