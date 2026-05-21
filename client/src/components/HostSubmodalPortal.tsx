import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import './HostSubmodalPortal.css';

export interface HostSubmodalPortalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  titleId?: string;
  maxWidth?: number | string;
  children: React.ReactNode;
}

/** Stacked above Round builder / Connection modals (portal + z-index). */
const HostSubmodalPortal: React.FC<HostSubmodalPortalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  titleId = 'host-submodal-title',
  maxWidth = '560px',
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="host-submodal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="host-submodal-backdrop"
        role="presentation"
        onClick={onClose}
      >
        <motion.div
          key="host-submodal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="host-submodal-panel"
          style={{ maxWidth }}
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="host-submodal-panel__header">
            <div className="host-submodal-panel__header-text">
              <h2 id={titleId} className="host-submodal-panel__title">
                {title}
              </h2>
              {subtitle ? <p className="host-submodal-panel__subtitle">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              className="host-submodal-panel__close"
              aria-label="Close"
              onClick={onClose}
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          </div>
          <div className="host-submodal-panel__body">{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

export default HostSubmodalPortal;
