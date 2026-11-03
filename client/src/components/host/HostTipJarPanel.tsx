import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../config';
import { hostFetch } from '../../utils/hostFetch';

export type HostTipJarLinks = {
  venmo?: string;
  cashapp?: string;
  paypal?: string;
  otherUrl?: string;
  otherLabel?: string;
};

export type HostTipJarConfig = {
  enabled: boolean;
  displayName?: string;
  presetCents: number[];
  allowCustomAmount: boolean;
  links: HostTipJarLinks;
  stripeConnectAccountId?: string;
  stripeConnectChargesEnabled?: boolean;
};

const DEFAULT_TIP_JAR: HostTipJarConfig = {
  enabled: false,
  displayName: 'Tip the host',
  presetCents: [300, 500, 1000],
  allowCustomAmount: true,
  links: {},
};

function centsToDollarsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

type HostTipJarPanelProps = {
  className?: string;
};

const HostTipJarPanel: React.FC<HostTipJarPanelProps> = ({ className }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [tipJar, setTipJar] = useState<HostTipJarConfig>(DEFAULT_TIP_JAR);
  const [presetsText, setPresetsText] = useState('3, 5, 10');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/tip-jar`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Could not load tip jar');
      }
      const tj = data.tipJar && typeof data.tipJar === 'object' ? data.tipJar : DEFAULT_TIP_JAR;
      setTipJar({
        enabled: tj.enabled === true,
        displayName: tj.displayName || 'Tip the host',
        presetCents: Array.isArray(tj.presetCents) ? tj.presetCents : [300, 500, 1000],
        allowCustomAmount: tj.allowCustomAmount !== false,
        links: tj.links && typeof tj.links === 'object' ? tj.links : {},
        stripeConnectAccountId: tj.stripeConnectAccountId,
        stripeConnectChargesEnabled: tj.stripeConnectChargesEnabled === true,
      });
      setPresetsText(
        (Array.isArray(tj.presetCents) ? tj.presetCents : [300, 500, 1000])
          .map((c: number) => (c / 100).toString())
          .join(', '),
      );
      setStripeConfigured(data.stripeConfigured === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tip jar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parsePresets = (text: string): number[] => {
    return text
      .split(/[,\s]+/)
      .map((p) => Math.round(Number(p) * 100))
      .filter((c) => Number.isFinite(c) && c >= 100 && c <= 10000)
      .slice(0, 6);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const presetCents = parsePresets(presetsText);
      const body = {
        ...tipJar,
        presetCents: presetCents.length ? presetCents : [300, 500, 1000],
      };
      const res = await hostFetch(`${API_BASE || ''}/api/org/tip-jar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'Save failed');
      const tj = data.tipJar || body;
      setTipJar({
        enabled: tj.enabled === true,
        displayName: tj.displayName || 'Tip the host',
        presetCents: Array.isArray(tj.presetCents) ? tj.presetCents : body.presetCents,
        allowCustomAmount: tj.allowCustomAmount !== false,
        links: tj.links || {},
        stripeConnectAccountId: tj.stripeConnectAccountId,
        stripeConnectChargesEnabled: tj.stripeConnectChargesEnabled === true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startConnect = async () => {
    setOnboarding(true);
    setError(null);
    try {
      const returnPath =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search || ''}`
          : '/org';
      const res = await hostFetch(`${API_BASE || ''}/api/org/tip-jar/stripe-connect/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnPath }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || 'Could not start Stripe Connect');
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('No onboarding URL returned');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect onboarding failed');
      setOnboarding(false);
    }
  };

  const setLink = (key: keyof HostTipJarLinks, value: string) => {
    setTipJar((prev) => ({
      ...prev,
      links: { ...prev.links, [key]: value },
    }));
  };

  if (loading) {
    return (
      <div className={className}>
        <p className="host-muted">Loading tip jar…</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <h3 style={{ margin: '0 0 6px', fontSize: '1rem', color: '#fff' }}>Tip jar</h3>
      <p className="host-muted" style={{ marginTop: 0, marginBottom: 12 }}>
        Players can tip you from their phone. Card tips go to your Stripe account (Tempo takes no cut).
        Venmo / Cash App / PayPal links open your apps.
      </p>

      {error ? (
        <p style={{ color: '#ff9e6e', fontSize: '0.85rem', marginBottom: 10 }}>{error}</p>
      ) : null}

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
          color: '#e8e8e8',
          fontSize: '0.9rem',
        }}
      >
        <input
          type="checkbox"
          checked={tipJar.enabled}
          onChange={(e) => setTipJar((p) => ({ ...p, enabled: e.target.checked }))}
        />
        Enable tipping for players
      </label>

      <label className="host-field" style={{ display: 'block', marginBottom: 10 }}>
        <span className="host-muted" style={{ display: 'block', marginBottom: 4 }}>
          Button label
        </span>
        <input
          type="text"
          value={tipJar.displayName || ''}
          onChange={(e) => setTipJar((p) => ({ ...p, displayName: e.target.value }))}
          placeholder="Tip the host"
          maxLength={60}
          style={{ width: '100%', maxWidth: 360 }}
        />
      </label>

      <label className="host-field" style={{ display: 'block', marginBottom: 10 }}>
        <span className="host-muted" style={{ display: 'block', marginBottom: 4 }}>
          Preset amounts (USD, comma-separated)
        </span>
        <input
          type="text"
          value={presetsText}
          onChange={(e) => setPresetsText(e.target.value)}
          placeholder="3, 5, 10"
          style={{ width: '100%', maxWidth: 360 }}
        />
      </label>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
          color: '#e8e8e8',
          fontSize: '0.85rem',
        }}
      >
        <input
          type="checkbox"
          checked={tipJar.allowCustomAmount}
          onChange={(e) => setTipJar((p) => ({ ...p, allowCustomAmount: e.target.checked }))}
        />
        Allow custom amount
      </label>

      <div style={{ display: 'grid', gap: 8, marginBottom: 14, maxWidth: 420 }}>
        <span className="host-muted" style={{ fontSize: '0.8rem' }}>
          Deep links (optional)
        </span>
        {(
          [
            ['venmo', 'Venmo URL'],
            ['cashapp', 'Cash App URL'],
            ['paypal', 'PayPal URL'],
            ['otherUrl', 'Other tip URL'],
          ] as const
        ).map(([key, label]) => (
          <input
            key={key}
            type="url"
            value={tipJar.links[key] || ''}
            onChange={(e) => setLink(key, e.target.value)}
            placeholder={label}
            style={{ width: '100%' }}
          />
        ))}
        <input
          type="text"
          value={tipJar.links.otherLabel || ''}
          onChange={(e) => setLink('otherLabel', e.target.value)}
          placeholder="Other link label (optional)"
          maxLength={40}
          style={{ width: '100%' }}
        />
      </div>

      <div
        style={{
          marginBottom: 14,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(0,0,0,0.25)',
          maxWidth: 420,
        }}
      >
        <div style={{ color: '#c8d8d0', fontSize: '0.85rem', marginBottom: 8 }}>
          Card tips (Stripe Connect)
        </div>
        {!stripeConfigured ? (
          <p className="host-muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            Stripe is not configured on this server — deep links still work.
          </p>
        ) : tipJar.stripeConnectChargesEnabled ? (
          <p style={{ margin: '0 0 8px', color: '#7dffa8', fontSize: '0.85rem' }}>
            Ready to receive card tips
            {tipJar.presetCents?.length
              ? ` · presets ${tipJar.presetCents.map(centsToDollarsLabel).join(', ')}`
              : ''}
          </p>
        ) : tipJar.stripeConnectAccountId ? (
          <p style={{ margin: '0 0 8px', color: '#fde68a', fontSize: '0.85rem' }}>
            Stripe setup incomplete — finish onboarding to accept cards.
          </p>
        ) : (
          <p className="host-muted" style={{ margin: '0 0 8px', fontSize: '0.8rem' }}>
            Connect Stripe to accept card tips on your phone.
          </p>
        )}
        {stripeConfigured ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={onboarding}
            onClick={() => void startConnect()}
            style={{ fontSize: '0.85rem' }}
          >
            {onboarding
              ? 'Redirecting…'
              : tipJar.stripeConnectAccountId
                ? 'Continue Stripe setup'
                : 'Connect with Stripe'}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={saving}
        onClick={() => void save()}
        style={{ fontSize: '0.9rem' }}
      >
        {saving ? 'Saving…' : 'Save tip jar'}
      </button>
    </div>
  );
};

export default HostTipJarPanel;
