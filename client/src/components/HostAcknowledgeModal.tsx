import React from 'react';

export type HostAckVariant = 'warning' | 'error' | 'info';

type Props = {
  open: boolean;
  title: string;
  message: string;
  variant?: HostAckVariant;
  acknowledgeLabel?: string;
  onAcknowledge: () => void;
};

/**
 * Blocks the host UI until acknowledged (no click-outside / Escape dismiss).
 * Use for API/rate-limit and other high-salience host notices.
 */
export default function HostAcknowledgeModal({
  open,
  title,
  message,
  variant = 'warning',
  acknowledgeLabel = 'I understand',
  onAcknowledge,
}: Props) {
  if (!open) return null;
  const border =
    variant === 'error'
      ? 'rgba(220, 53, 69, 0.55)'
      : variant === 'info'
        ? 'rgba(100, 180, 255, 0.45)'
        : 'rgba(255, 200, 80, 0.5)';

  return (
    <div
      className="host-acknowledge-modal__backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="host-ack-title"
    >
      <div
        className="host-acknowledge-modal__panel"
        style={{ border: `1px solid ${border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="host-ack-title" className="host-acknowledge-modal__title">
          {title}
        </h2>
        <p className="host-acknowledge-modal__message">{message}</p>
        <div className="host-acknowledge-modal__actions">
          <button
            type="button"
            onClick={onAcknowledge}
            className="btn host-acknowledge-modal__ack"
            autoFocus
          >
            {acknowledgeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
