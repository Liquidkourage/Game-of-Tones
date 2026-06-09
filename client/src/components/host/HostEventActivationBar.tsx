import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarX, Loader2 } from 'lucide-react';
import { API_BASE } from '../../config';
import { hostFetch } from '../../utils/hostFetch';

type EventStatus = {
  billingReady?: boolean;
  skipped?: boolean;
  noOrg?: boolean;
  active?: boolean;
  trialActive?: boolean;
  enterpriseUnlimited?: boolean;
  credits?: number;
  event?: {
    id: number;
    activatedAt?: string;
    closesAt?: string;
    creditConsumed?: boolean;
    roundsStarted?: number;
    songsPlayed?: number;
    playerPeak?: number;
  } | null;
};

type HostEventActivationBarProps = {
  roomId: string;
};

const HostEventActivationBar: React.FC<HostEventActivationBarProps> = ({ roomId }) => {
  const [status, setStatus] = useState<EventStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const res = await hostFetch(
        `${API_BASE || ''}/api/org/event-status?roomId=${encodeURIComponent(roomId)}`,
      );
      if (!res.ok) {
        setStatus(null);
        return;
      }
      setStatus((await res.json()) as EventStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return null;
  if (!status?.billingReady || status.skipped || status.noOrg) return null;

  const activateEvent = async () => {
    const ok = window.confirm(
      status.trialActive || status.enterpriseUnlimited
        ? 'Activate this event?'
        : 'Activate? Uses 1 credit.',
    );
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/event/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((j && j.message) || `Could not activate (${res.status})`);
        return;
      }
      setMessage(
        j.consumed
          ? 'Activated — 1 credit used.'
          : j.trial
            ? 'Activated — trial.'
            : j.enterprise
              ? 'Activated — Enterprise.'
              : 'Already active.',
      );
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const endEvent = async () => {
    const ok = window.confirm('End this event?');
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await hostFetch(`${API_BASE || ''}/api/org/event/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage((j && j.message) || `Could not end (${res.status})`);
        return;
      }
      setMessage(
        j.refunded
          ? `Ended — refunded. Credits: ${j.credits ?? '—'}.`
          : j.closed
            ? `Ended.${typeof j.credits === 'number' ? ` Credits: ${j.credits}.` : ''}`
            : 'No active event.',
      );
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const closesLabel =
    status.event?.closesAt && Number.isFinite(new Date(status.event.closesAt).getTime())
      ? new Date(status.event.closesAt).toLocaleString()
      : null;

  return (
    <section className="host-event-activation host-glass-panel" aria-label="Event activation">
      <div className="host-event-activation__head">
        <h3 className="host-event-activation__title">
          Event
        </h3>
        {status.trialActive ? (
          <span className="host-event-activation__badge">Trial</span>
        ) : status.enterpriseUnlimited ? (
          <span className="host-event-activation__badge">Enterprise</span>
        ) : (
          <span className="host-event-activation__badge">{status.credits ?? 0} credits</span>
        )}
      </div>
      {status.active ? (
        <p className="host-event-activation__lead">
          Active
          {closesLabel ? ` · ${closesLabel}` : ''}
          {status.event?.roundsStarted ? ` · ${status.event.roundsStarted} rounds` : ''}
        </p>
      ) : (
        <p className="host-event-activation__lead">
          Inactive ·{' '}
          <Link to="/org" target="_blank" rel="noopener noreferrer">
            Account
          </Link>
        </p>
      )}
      {message ? <p className="host-event-activation__msg">{message}</p> : null}
      <div className="host-event-activation__actions">
        {!status.active ? (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void activateEvent()}>
            {busy ? <Loader2 className="host-event-activation__spin" aria-hidden /> : <CalendarCheck size={16} aria-hidden />}
            Activate
          </button>
        ) : (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void endEvent()}>
            {busy ? <Loader2 className="host-event-activation__spin" aria-hidden /> : <CalendarX size={16} aria-hidden />}
            End
          </button>
        )}
      </div>
    </section>
  );
};

export default HostEventActivationBar;
