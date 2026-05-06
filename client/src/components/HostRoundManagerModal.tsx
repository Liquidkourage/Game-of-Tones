import React from 'react';
import { CalendarRange, X } from 'lucide-react';

/** Tall overlay for round/event overview + per-round save/PDF/prep (same chrome as connection modal). */
const HostRoundManagerModal: React.FC<{
  onClose: () => void;
  children: React.ReactNode;
}> = ({ onClose, children }) => {
  return (
    <div
      className="host-connection-modal-backdrop"
      onClick={onClose}
      role="presentation"
      style={{ zIndex: 10055 }}
    >
      <div
        className="host-connection-modal host-connection-modal--round-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-round-manager-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="host-connection-modal__header">
          <h2 id="host-round-manager-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarRange className="w-5 h-5" style={{ color: '#00ff88' }} aria-hidden />
            Round & event management
          </h2>
          <button type="button" className="host-connection-modal__close" aria-label="Close" onClick={onClose}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
        <div className="host-connection-modal__body">{children}</div>
      </div>
    </div>
  );
};

export default HostRoundManagerModal;
