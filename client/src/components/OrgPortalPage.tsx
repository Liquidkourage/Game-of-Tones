import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Building2,
  Crown,
  Loader2,
  Mail,
  Users,
  ArrowLeft,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { API_BASE } from '../config';
import { browserGoogleLoginUrl, hostFetch } from '../utils/hostFetch';

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
      setBanner('Thank you! Payment received — your organization billing is updated.');
      const next = new URLSearchParams(searchParams);
      next.delete('billing');
      setSearchParams(next, { replace: true });
      refresh();
    } else if (billingNotice === 'cancelled') {
      setBanner('Checkout cancelled — you can try again anytime.');
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
      setBanner(`Invited ${email}. They can sign in with Google using that address.`);
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
          Loading organization…
        </p>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="org-portal">
        <Link to="/?mode=host" className="org-portal__back">
          <ArrowLeft aria-hidden /> Back
        </Link>
        <h1 className="org-portal__title">
          <Building2 aria-hidden /> Organization
        </h1>
        <p className="org-portal__lead">Sign in with Google to create or manage your venue organization.</p>
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
      <Link to="/?mode=host" className="org-portal__back">
        <ArrowLeft aria-hidden /> Back to host
      </Link>

      <header className="org-portal__header">
        <h1 className="org-portal__title">
          <Building2 aria-hidden /> Organization
        </h1>
        <p className="org-portal__lead">
          One organization covers every host you invite. Event credits, subscriptions, and packs are managed here.
        </p>
      </header>

      {banner ? (
        <div className="org-portal__banner" role="status">
          {banner}
        </div>
      ) : null}

      {data?.billing?.gateEnforced ? (
        <div className="org-portal__notice org-portal__notice--warn" role="note">
          Hosting requires organization support on this server.{' '}
          {data.billing.active ? 'Your org is covered.' : 'Complete payment below to host.'}
        </div>
      ) : data?.billing?.gateEnabled && !data?.billing?.billingReady ? (
        <div className="org-portal__notice" role="note">
          Billing gate is enabled but Stripe setup is not finished yet — hosting stays open until checkout and
          webhooks are configured.
        </div>
      ) : (
        <div className="org-portal__notice" role="note">
          Hosting is open for everyone right now. Support is optional and helps keep TEMPO running.
        </div>
      )}

      {!org ? (
        <section className="org-portal__card">
          <h2>Create your organization</h2>
          <p>Venue name, school, or team — you will be the owner and can invite other hosts.</p>
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
              {enterpriseUnlimited ? <> · <strong>Unlimited events</strong></> : null}
              {!enterpriseUnlimited ? (
                <>
                  {' '}
                  · Credits: <strong>{creditTotal}</strong>
                </>
              ) : null}
            </p>
          </section>

          {isOwner ? (
            <>
              {data?.billing?.stripeConfigured ? (
                <>
                  <section className="org-portal__card">
                    <h2>Event credits</h2>
                    <p>
                      One credit = one activated event night (up to 12 rounds), unlimited players. Credits are used when
                      you print full cards or Start Game.
                    </p>
                    {enterpriseUnlimited ? (
                      <p className="org-portal__muted">Enterprise — unlimited activations on your plan.</p>
                    ) : trialActive ? (
                      <p className="org-portal__muted">Trial active — unlimited event nights until trial ends.</p>
                    ) : (
                      <p className="org-portal__muted">
                        Available credits: <strong>{creditTotal}</strong>
                      </p>
                    )}
                    <div className="org-portal__row org-portal__row--custom" style={{ marginTop: 12 }}>
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void buySingleEvent()}>
                        Buy one event (${singleEventUsd})
                      </button>
                      {!trialActive && !data?.billing?.trialEndsAt ? (
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void buyTrial()}>
                          7-day trial ($29)
                        </button>
                      ) : null}
                    </div>
                  </section>

                  {subscriptionTiers.length > 0 ? (
                    <section className="org-portal__card">
                      <h2>Monthly plans</h2>
                      <p>Recurring subscription — includes monthly event credits. Pause or cancel in Stripe portal.</p>
                      {subscriptionActive || subscriptionPaused ? (
                        <div className="org-portal__row">
                          <p className="org-portal__muted">
                            {subscriptionPaused
                              ? 'Subscription paused — existing credits still work. Resume in Manage billing.'
                              : `Active (${data?.billing?.subscriptionTier || data?.billing?.subscriptionStatus}${
                                  subscriptionPeriodEnd ? ` · renews ${subscriptionPeriodEnd}` : ''
                                }).`}
                          </p>
                          <button type="button" className="btn-primary" disabled={busy} onClick={() => void openBillingPortal()}>
                            Manage billing
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className="org-portal__custom-label" style={{ marginBottom: 8 }}>
                            Promo code (optional)
                            <input
                              type="text"
                              className="input"
                              value={promoCode}
                              onChange={(e) => setPromoCode(e.target.value)}
                              placeholder="PARTNER20"
                            />
                          </label>
                          <div className="org-portal__amounts">
                            {subscriptionTiers.map((tier) => (
                              <button
                                key={tier.key}
                                type="button"
                                className="btn-secondary org-portal__amount-btn"
                                disabled={busy}
                                onClick={() => void startSubscription(tier.key)}
                              >
                                {tier.label}
                                {tier.eventsPerMonth ? ` · ${tier.eventsPerMonth}/mo` : tier.unlimited ? ' · unlimited' : ''}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </section>
                  ) : null}

                  {packProducts.length > 0 ? (
                    <section className="org-portal__card">
                      <h2>Event packs</h2>
                      <p>Requires active Basic or higher. Not available during trial-only or without a subscription.</p>
                      <div className="org-portal__amounts">
                        {packProducts.map((pack) => (
                          <button
                            key={pack.key}
                            type="button"
                            className="btn-secondary org-portal__amount-btn"
                            disabled={busy || !packsEligible}
                            title={packsEligible ? undefined : 'Subscribe to Basic+ first'}
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
                  <div className="org-portal__stripe-setup">
                    <p>
                      <strong>Server setup required.</strong> Add Stripe env vars on Railway (or your host), then redeploy.
                      Full guide:{' '}
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
                </section>
              ) : null}

              <section className="org-portal__card">
                <h2>
                  <Mail aria-hidden /> Invite hosts
                </h2>
                <p>They sign in with Google using this exact email. Payment on this org covers them.</p>
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
                      setBanner('You are now the organization owner.');
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Crown size={16} aria-hidden /> Claim as owner
                </button>
              ) : (
                <p className="org-portal__muted">Another host may already be the owner, or ownership was set in Admin.</p>
              )}
            </section>
          )}

          <section className="org-portal__card">
            <h2>
              <Users aria-hidden /> Hosts in this org ({data?.members?.length ?? 0})
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
              <h2>Recent payments</h2>
              <ul className="org-portal__list org-portal__payments">
                {data.payments.map((p) => (
                  <li key={p.id}>
                    ${(p.amount_cents / 100).toFixed(2)} {p.currency?.toUpperCase()} — {p.status}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

export default OrgPortalPage;
