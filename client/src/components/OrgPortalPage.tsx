import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Crown,
  Loader2,
  Mail,
  Users,
  ArrowLeft,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  UserCircle,
} from 'lucide-react';
import { API_BASE } from '../config';
import { browserGoogleLoginUrl, hostFetch } from '../utils/hostFetch';
import ContextHelp from './ContextHelp';
import './ContextHelp.css';

type OrgMember = { id: number; email: string | null; displayName: string | null; createdAt?: string };
type OrgInvite = { email: string; created_at?: string };
type OrgPayment = {
  id: number;
  amount_cents: number;
  currency: string;
  status: string;
  created_at?: string;
  completed_at?: string | null;
};

type SubscriptionPlan = {
  key: string;
  interval: 'month' | 'year';
  label: string;
  usd: number;
  eventsPerMonth?: number | null;
  unlimited?: boolean;
  annualSavingsPercent?: number;
};

type OrgMe = {
  role: 'owner' | 'host' | null;
  organization: {
    id: number;
    name: string;
    billing_status?: string;
    lifetime_paid_cents?: number;
    last_payment_at?: string | null;
  } | null;
  members: OrgMember[];
  invites: OrgInvite[];
  payments: OrgPayment[];
  billing: {
    gateEnabled: boolean;
    gateEnforced?: boolean;
    billingReady?: boolean;
    stripeConfigured: boolean;
    subscriptionsConfigured?: boolean;
    subscriptionTiers?: {
      key: string;
      label: string;
      usd: number;
      priceId?: string;
      eventsPerMonth?: number | null;
      unlimited?: boolean;
    }[];
    subscriptionPlans?: SubscriptionPlan[];
    annualDiscountPercent?: number;
    packProducts?: { key: string; label: string; usd: number; credits: number }[];
    oneTimeProducts?: { key: string; label: string; usd: number }[];
    singleEventUsd?: number;
    active: boolean;
    status: string;
    lifetimePaidCents: number;
    lastPaymentAt: string | null;
    subscriptionStatus?: string;
    subscriptionPeriodEnd?: string | null;
    subscriptionActive?: boolean;
    subscriptionTier?: string;
    subscriptionPaused?: boolean;
    trialActive?: boolean;
    trialEndsAt?: string | null;
    credits?: { total: number; bySource: Record<string, number> };
    packsEligible?: boolean;
    enterpriseUnlimited?: boolean;
  };
};

const SUGGESTED_AMOUNTS_USD = [10, 25, 50, 100];

async function billingCheckoutPost(path: string, body: Record<string, unknown> = {}) {
  const res = await hostFetch(`${API_BASE || ''}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((j && j.message) || `Checkout failed (${res.status})`);
  }
  if (!j.url) throw new Error('No checkout URL returned.');
  window.location.href = j.url;
}

type BillingSetup = {
  stripeSecretConfigured: boolean;
  stripeWebhookConfigured: boolean;
  stripeKeyMode: string | null;
  publicAppUrl: string;
  webhookUrl: string;
  ready: boolean;
};

const OrgPortalPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<OrgMe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [customAmount, setCustomAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [billingSetup, setBillingSetup] = useState<BillingSetup | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [planInterval, setPlanInterval] = useState<'month' | 'year'>('month');

  const billingNotice = searchParams.get('billing');

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      alert('Copy failed — select the text and copy manually.');
    }
  };

  const refresh = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/me`);
      if (res.status === 401) {
        setNeedsLogin(true);
        setData(null);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setLoadError((j && j.message) || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setNeedsLogin(false);
      setData((await res.json()) as OrgMe);
    } catch (e) {
      setLoadError(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!data?.billing?.stripeConfigured && data?.role === 'owner') {
      let cancelled = false;
      (async () => {
        try {
          const res = await hostFetch(`${API_BASE || ''}/api/org/billing/setup`);
          if (!res.ok || cancelled) return;
          const j = (await res.json()) as { setup?: BillingSetup };
          if (!cancelled && j.setup) setBillingSetup(j.setup);
        } catch {
          /* ignore */
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    setBillingSetup(null);
  }, [data?.billing?.stripeConfigured, data?.role]);

  useEffect(() => {
    if (billingNotice === 'success') {
      setBanner('Payment received.');
      const next = new URLSearchParams(searchParams);
      next.delete('billing');
      setSearchParams(next, { replace: true });
      refresh();
    } else if (billingNotice === 'cancelled') {
      setBanner('Checkout cancelled.');
      const next = new URLSearchParams(searchParams);
      next.delete('billing');
      setSearchParams(next, { replace: true });
    } else if (billingNotice === 'portal') {
      setBanner('Returned from Stripe billing portal.');
      const next = new URLSearchParams(searchParams);
      next.delete('billing');
      setSearchParams(next, { replace: true });
      refresh();
    }
  }, [billingNotice, refresh, searchParams, setSearchParams]);

  const lifetimeUsd = useMemo(() => {
    const c = data?.billing?.lifetimePaidCents ?? 0;
    return (c / 100).toFixed(2);
  }, [data?.billing?.lifetimePaidCents]);

  const createOrg = async () => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((j && j.message) || `Could not create organization (${res.status})`);
        return;
      }
      setOrgName('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((j && j.message) || `Invite failed (${res.status})`);
        return;
      }
      setInviteEmail('');
      setBanner(`Invited ${email}.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const startCheckout = async (usd: number) => {
    const cents = Math.round(usd * 100);
    setBusy(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: cents }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((j && j.message) || `Checkout failed (${res.status})`);
        return;
      }
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      alert('No checkout URL returned.');
    } finally {
      setBusy(false);
    }
  };

  const payCustom = () => {
    const usd = parseFloat(customAmount);
    if (!Number.isFinite(usd) || usd < 1) {
      alert('Enter at least $1.00');
      return;
    }
    if (usd > 5000) {
      alert('Maximum custom amount is $5,000');
      return;
    }
    startCheckout(usd);
  };

  const startSubscription = async (tierKey: string) => {
    setBusy(true);
    try {
      await billingCheckoutPost('/api/org/billing/subscribe', {
        tierKey,
        billingInterval: planInterval,
        ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buyTrial = async () => {
    setBusy(true);
    try {
      await billingCheckoutPost('/api/org/billing/trial');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buySingleEvent = async () => {
    setBusy(true);
    try {
      await billingCheckoutPost('/api/org/billing/single-event');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buyPack = async (packKey: string) => {
    setBusy(true);
    try {
      await billingCheckoutPost('/api/org/billing/pack', { packKey });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openBillingPortal = async () => {
    setBusy(true);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/billing/portal`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert((j && j.message) || `Could not open billing portal (${res.status})`);
        return;
      }
      if (j.url) {
        window.location.href = j.url;
        return;
      }
      alert('No portal URL returned.');
    } finally {
      setBusy(false);
    }
  };

  const subscriptionTiers = data?.billing?.subscriptionTiers ?? [];
  const subscriptionPlans: SubscriptionPlan[] = (
    data?.billing?.subscriptionPlans?.length
      ? data.billing.subscriptionPlans
      : subscriptionTiers.map((tier) => ({
          key: tier.key,
          interval: 'month' as const,
          label: tier.label,
          usd: tier.usd,
          eventsPerMonth: tier.eventsPerMonth,
          unlimited: tier.unlimited,
        }))
  ) as SubscriptionPlan[];
  const visiblePlans = subscriptionPlans.filter((p) => p.interval === planInterval);
  const annualDiscount = data?.billing?.annualDiscountPercent ?? 15;
  const packProducts = data?.billing?.packProducts ?? [];
  const subscriptionActive = !!data?.billing?.subscriptionActive;
  const subscriptionPaused = !!data?.billing?.subscriptionPaused;
  const trialActive = !!data?.billing?.trialActive;
  const creditTotal = data?.billing?.credits?.total ?? 0;
  const enterpriseUnlimited = !!data?.billing?.enterpriseUnlimited;
  const packsEligible = !!data?.billing?.packsEligible;
  const singleEventUsd = data?.billing?.singleEventUsd ?? 15;
  const subscriptionPeriodEnd = data?.billing?.subscriptionPeriodEnd
    ? new Date(data.billing.subscriptionPeriodEnd).toLocaleDateString()
    : null;

  if (loading) {
    return (
      <div className="org-portal">
        <p className="org-portal__loading">
          <Loader2 className="org-portal__spin" aria-hidden />
          Loading…
        </p>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="org-portal">
        <Link to="/" className="org-portal__back">
          <ArrowLeft aria-hidden /> Home
        </Link>
        <h1 className="org-portal__title">
          <UserCircle aria-hidden /> Account
        </h1>
        <button
          type="button"
          className="btn-primary org-portal__cta"
          onClick={() => {
            try {
              sessionStorage.setItem('tempo_post_auth_return', '/org');
            } catch {
              /* ignore */
            }
            window.location.href = browserGoogleLoginUrl();
          }}
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="org-portal">
        <p className="org-portal__error" role="alert">
          <AlertCircle aria-hidden /> {loadError}
        </p>
        <button type="button" className="btn-secondary" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  const org = data?.organization;
  const isOwner = data?.role === 'owner';

  return (
    <div className="org-portal">
      <Link to="/" className="org-portal__back">
        <ArrowLeft aria-hidden /> Home
      </Link>

      <header className="org-portal__header">
        <h1 className="org-portal__title">
          <UserCircle aria-hidden /> Account
        </h1>
      </header>

      {banner ? (
        <div className="org-portal__banner" role="status">
          {banner}
        </div>
      ) : null}

      {data?.billing?.gateEnforced && !data.billing.active ? (
        <div className="org-portal__notice org-portal__notice--warn" role="note">
          Payment required to host.
        </div>
      ) : null}

      {!org ? (
        <section className="org-portal__card">
          <div className="org-portal__section-head">
            <h2>Create org</h2>
            <ContextHelp title="Create org">
              <p>Venue, school, or team name. You become owner and can invite co-hosts.</p>
            </ContextHelp>
          </div>
          <div className="org-portal__row">
            <input
              type="text"
              className="input"
              placeholder="e.g. Acme Karaoke Nights"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              maxLength={80}
            />
            <button type="button" className="btn-primary" disabled={busy || orgName.trim().length < 2} onClick={createOrg}>
              {busy ? <Loader2 className="org-portal__spin" aria-hidden /> : 'Create'}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="org-portal__card org-portal__card--highlight">
            <div className="org-portal__org-head">
              <h2>{org.name}</h2>
              {isOwner ? (
                <span className="org-portal__badge">
                  <Crown size={14} aria-hidden /> Owner
                </span>
              ) : (
                <span className="org-portal__badge org-portal__badge--host">Host</span>
              )}
            </div>
            <p className="org-portal__meta">
              Status: <strong>{data?.billing?.status || 'none'}</strong>
              {trialActive ? (
                <>
                  {' '}
                  · Trial until{' '}
                  <strong>
                    {data?.billing?.trialEndsAt
                      ? new Date(data.billing.trialEndsAt).toLocaleDateString()
                      : '—'}
                  </strong>
                </>
              ) : null}
              {subscriptionActive || subscriptionPaused ? (
                <>
                  {' '}
                  · Plan: <strong>{data?.billing?.subscriptionTier || data?.billing?.subscriptionStatus}</strong>
                  {subscriptionPaused ? <> (paused)</> : null}
                  {subscriptionPeriodEnd ? <> · Renews {subscriptionPeriodEnd}</> : null}
                </>
              ) : null}
              {enterpriseUnlimited ? <> · Unlimited</> : null}
            </p>
          </section>

          {isOwner ? (
            <>
              {data?.billing?.stripeConfigured ? (
                <>
                  <section className="org-portal__card">
                    <div className="org-portal__section-head">
                      <h2>Plans</h2>
                      <ContextHelp title="Plans">
                        <p>Monthly or annual subscription. Includes event credits each month. Pause or cancel in Stripe.</p>
                      </ContextHelp>
                    </div>
                    {subscriptionActive || subscriptionPaused ? (
                      <div className="org-portal__row">
                        <p className="org-portal__muted">
                          {subscriptionPaused
                            ? 'Paused'
                            : `${data?.billing?.subscriptionTier || data?.billing?.subscriptionStatus}${
                                subscriptionPeriodEnd ? ` · ${subscriptionPeriodEnd}` : ''
                              }`}
                        </p>
                        <button type="button" className="btn-primary" disabled={busy} onClick={() => void openBillingPortal()}>
                          Billing
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="org-portal__row" style={{ marginBottom: 10 }}>
                          <div className="org-portal__interval-toggle" role="group" aria-label="Billing interval">
                            <button
                              type="button"
                              className={`btn-secondary${planInterval === 'month' ? ' is-active' : ''}`}
                              disabled={busy}
                              onClick={() => setPlanInterval('month')}
                            >
                              Monthly
                            </button>
                            <button
                              type="button"
                              className={`btn-secondary${planInterval === 'year' ? ' is-active' : ''}`}
                              disabled={busy}
                              onClick={() => setPlanInterval('year')}
                            >
                              Annual −{annualDiscount}%
                            </button>
                          </div>
                        </div>
                        <label className="org-portal__custom-label" style={{ marginBottom: 8 }}>
                          Promo
                          <input
                            type="text"
                            className="input"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value)}
                            placeholder="CODE"
                          />
                        </label>
                        <div className="org-portal__amounts">
                          {visiblePlans.map((tier) => (
                            <button
                              key={`${tier.key}-${tier.interval}`}
                              type="button"
                              className="btn-secondary org-portal__amount-btn"
                              disabled={busy}
                              onClick={() => void startSubscription(tier.key)}
                            >
                              {tier.label}
                              {tier.eventsPerMonth ? ` · ${tier.eventsPerMonth}/mo` : tier.unlimited ? ' · ∞' : ''}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="org-portal__row org-portal__row--custom" style={{ marginTop: 12 }}>
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void buySingleEvent()}>
                        One event (${singleEventUsd})
                      </button>
                      {!trialActive && !data?.billing?.trialEndsAt ? (
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void buyTrial()}>
                          Trial ($29)
                        </button>
                      ) : null}
                    </div>
                  </section>

                  {packProducts.length > 0 ? (
                    <section className="org-portal__card">
                      <div className="org-portal__section-head">
                        <h2>Packs</h2>
                        <ContextHelp title="Packs">
                          <p>Requires active Basic+ subscription. Not available during trial-only.</p>
                        </ContextHelp>
                      </div>
                      <div className="org-portal__amounts">
                        {packProducts.map((pack) => (
                          <button
                            key={pack.key}
                            type="button"
                            className="btn-secondary org-portal__amount-btn"
                            disabled={busy || !packsEligible}
                            title={packsEligible ? undefined : 'Basic+ required'}
                            onClick={() => void buyPack(pack.key)}
                          >
                            {pack.label}
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}

              {!data?.billing?.stripeConfigured ? (
                <section className="org-portal__card">
                  <details>
                    <summary>Stripe setup</summary>
                    <div className="org-portal__stripe-setup">
                      <p>
                        Guide:{' '}
                        <a
                          href="https://github.com/Liquidkourage/Game-of-Tones/blob/main/STRIPE_SETUP.md"
                          target="_blank"
                          rel="noreferrer"
                        >
                          STRIPE_SETUP.md <ExternalLink size={14} aria-hidden style={{ verticalAlign: 'middle' }} />
                        </a>
                      </p>
                    <ol className="org-portal__setup-steps">
                      <li>
                        <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noreferrer">
                          Stripe → API keys
                        </a>{' '}
                        — set <code>STRIPE_SECRET_KEY</code> (<code>sk_test_…</code> while testing)
                      </li>
                      <li>
                        <a href="https://dashboard.stripe.com/test/webhooks" target="_blank" rel="noreferrer">
                          Stripe → Webhooks
                        </a>{' '}
                        — endpoint below, events                         <code>checkout.session.completed</code>,{' '}
                        <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>,{' '}
                        <code>invoice.payment_succeeded</code>, <code>invoice.payment_failed</code> → set{' '}
                        <code>STRIPE_WEBHOOK_SECRET</code>
                      </li>
                      <li>
                        Create Prices in Stripe → set{' '}
                        <code>STRIPE_PRICE_MONTHLY_BASIC</code> through <code>STRIPE_PRICE_MONTHLY_ENTERPRISE</code>,{' '}
                        <code>STRIPE_PRICE_TRIAL_7D</code>, <code>STRIPE_PRICE_SINGLE_EVENT</code>, pack prices
                      </li>
                      <li>
                        Set <code>PUBLIC_APP_URL</code> to your app URL (where users open TEMPO)
                      </li>
                    </ol>
                    {billingSetup ? (
                      <div className="org-portal__setup-vars">
                        <div className="org-portal__setup-row">
                          <span className="org-portal__setup-label">Webhook URL</span>
                          <code className="org-portal__setup-value">{billingSetup.webhookUrl}</code>
                          <button
                            type="button"
                            className="btn-secondary org-portal__copy-btn"
                            onClick={() => void copyText('webhook', billingSetup.webhookUrl)}
                          >
                            {copiedField === 'webhook' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                            Copy
                          </button>
                        </div>
                        <div className="org-portal__setup-row">
                          <span className="org-portal__setup-label">PUBLIC_APP_URL</span>
                          <code className="org-portal__setup-value">{billingSetup.publicAppUrl}</code>
                          <button
                            type="button"
                            className="btn-secondary org-portal__copy-btn"
                            onClick={() => void copyText('app', billingSetup.publicAppUrl)}
                          >
                            {copiedField === 'app' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                            Copy
                          </button>
                        </div>
                        <p className="org-portal__muted org-portal__setup-status">
                          Secret key: {billingSetup.stripeSecretConfigured ? 'set' : 'missing'} · Webhook secret:{' '}
                          {billingSetup.stripeWebhookConfigured ? 'set' : 'missing'}
                          {billingSetup.stripeKeyMode ? ` · Mode: ${billingSetup.stripeKeyMode}` : ''}
                        </p>
                      </div>
                    ) : null}
                    </div>
                  </details>
                </section>
              ) : null}

              <section className="org-portal__card">
                <div className="org-portal__section-head">
                  <h2>
                    <Mail aria-hidden /> Invites
                  </h2>
                  <ContextHelp title="Invites">
                    <p>Co-hosts sign in with Google using this exact email. Your org billing covers them.</p>
                  </ContextHelp>
                </div>
                <div className="org-portal__row">
                  <input
                    type="email"
                    className="input"
                    placeholder="host@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <button type="button" className="btn-primary" disabled={busy || !inviteEmail.trim()} onClick={sendInvite}>
                    Invite
                  </button>
                </div>
                {data.invites.length > 0 ? (
                  <ul className="org-portal__list">
                    {data.invites.map((inv) => (
                      <li key={inv.email}>{inv.email}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </>
          ) : (
            <section className="org-portal__card">
              <p>
                Billing and invites are managed by the organization owner. If you set up this venue and you&apos;re the
                only host listed below, claim ownership to unlock those controls.
              </p>
              {(data?.members?.length ?? 0) <= 1 ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await hostFetch(`${API_BASE || ''}/api/org/claim-ownership`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: '{}',
                      });
                      const j = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        alert((j && j.message) || `Claim failed (${res.status})`);
                        return;
                      }
                      setBanner('You are now owner.');
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Crown size={16} aria-hidden /> Claim owner
                </button>
              ) : null}
            </section>
          )}

          <section className="org-portal__card">
            <h2>
              <Users aria-hidden /> Hosts ({data?.members?.length ?? 0})
            </h2>
            <ul className="org-portal__list">
              {(data?.members ?? []).map((m) => (
                <li key={m.id}>
                  {m.displayName || m.email || `User #${m.id}`}
                  {m.email ? <span className="org-portal__muted"> — {m.email}</span> : null}
                </li>
              ))}
            </ul>
          </section>

          {isOwner && data?.payments && data.payments.length > 0 ? (
            <section className="org-portal__card">
              <h2>Payments</h2>
              <ul className="org-portal__list org-portal__payments">
                {data.payments.map((p) => (
                  <li key={p.id}>
                    ${(p.amount_cents / 100).toFixed(2)} {p.currency?.toUpperCase()} — {p.status}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className="org-portal__card org-portal__credits-footer">
            <div className="org-portal__section-head">
              <h2>Credits</h2>
              <ContextHelp title="Credits">
                <p>One credit = one event night (up to 12 rounds). Used when you print full cards or Start Game.</p>
              </ContextHelp>
            </div>
            {enterpriseUnlimited ? (
              <p className="org-portal__muted">Unlimited</p>
            ) : trialActive ? (
              <p className="org-portal__muted">
                Trial
                {data?.billing?.trialEndsAt
                  ? ` · until ${new Date(data.billing.trialEndsAt).toLocaleDateString()}`
                  : ''}
              </p>
            ) : (
              <>
                <p className="org-portal__meta">
                  Available: <strong>{creditTotal}</strong>
                  {lifetimeUsd !== '0.00' ? (
                    <>
                      {' '}
                      · Paid ${lifetimeUsd} lifetime
                    </>
                  ) : null}
                </p>
                {creditTotal > 0 && data?.billing?.credits?.bySource ? (
                  <ul className="org-portal__credit-sources">
                    {Object.entries(data.billing.credits.bySource).map(([source, n]) =>
                      n > 0 ? (
                        <li key={source}>
                          {source}: <strong>{n}</strong>
                        </li>
                      ) : null,
                    )}
                  </ul>
                ) : null}
              </>
            )}
          </footer>
        </>
      )}
    </div>
  );
};

export default OrgPortalPage;
