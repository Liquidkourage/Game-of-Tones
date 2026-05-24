import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Crown, Heart, Loader2, Users } from 'lucide-react';
import { API_BASE } from '../../config';
import { hostFetch } from '../../utils/hostFetch';

type OrgMe = {
  role: 'owner' | 'host' | null;
  organization: { id: number; name: string } | null;
  members: { id: number }[];
  billing: {
    gateEnabled: boolean;
    active: boolean;
    status: string;
    lifetimePaidCents: number;
  };
};

const HostOrgBillingCard: React.FC = () => {
  const [data, setData] = useState<OrgMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/me`);
      if (res.status === 401) {
        setNeedsLogin(true);
        setData(null);
        return;
      }
      if (!res.ok) {
        setData(null);
        return;
      }
      setNeedsLogin(false);
      setData((await res.json()) as OrgMe);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="host-glass-panel host-org-billing-card" aria-labelledby="host-org-billing-title">
      <div className="host-org-billing-card__head">
        <h2 id="host-org-billing-title" className="host-settings-workspace__title">
          <Building2 className="host-settings-workspace__title-icon" aria-hidden />
          Organization &amp; billing
        </h2>
        <Link to="/org" className="btn-primary host-org-billing-card__open">
          {data?.organization ? 'Manage' : 'Set up'}
        </Link>
      </div>
      <p className="host-settings-workspace__lead">
        Create your venue org, invite co-hosts, and pay as you like — one payment covers every host in the org.
      </p>

      {loading ? (
        <p className="host-org-billing-card__status">
          <Loader2 className="host-org-billing-card__spin" aria-hidden /> Loading…
        </p>
      ) : needsLogin ? (
        <p className="host-org-billing-card__status">
          Sign in with Google on the{' '}
          <Link to="/?mode=host">home page</Link> to use organization features.
        </p>
      ) : data?.organization ? (
        <div className="host-org-billing-card__summary">
          <p className="host-org-billing-card__org-name">
            <strong>{data.organization.name}</strong>
            {data.role === 'owner' ? (
              <span className="host-org-billing-card__role">
                <Crown size={14} aria-hidden /> Owner
              </span>
            ) : (
              <span className="host-org-billing-card__role host-org-billing-card__role--host">Host</span>
            )}
          </p>
          <p className="host-org-billing-card__meta">
            <Users size={14} aria-hidden /> {data.members.length} host{data.members.length === 1 ? '' : 's'}
            {' · '}
            Billing: <strong>{data.billing.status}</strong>
            {data.billing.lifetimePaidCents > 0 ? (
              <> · ${(data.billing.lifetimePaidCents / 100).toFixed(2)} lifetime support</>
            ) : null}
          </p>
          {data.billing.gateEnabled && !data.billing.active && data.role === 'owner' ? (
            <p className="host-org-billing-card__warn">
              <Heart size={14} aria-hidden /> Hosting will require org support soon — complete payment in Manage.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="host-org-billing-card__status">
          No organization yet. Open <strong>Set up</strong> to create one and invite your team.
        </p>
      )}
    </section>
  );
};

export default HostOrgBillingCard;
