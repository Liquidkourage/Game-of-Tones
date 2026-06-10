import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HOST_TUTORIAL_STEPS } from '../../host/hostTutorialSteps';
import './HostTutorial.css';

export type HostTutorialProps = {
  open: boolean;
  stepIndex: number;
  onStepChange: (index: number) => void;
  onClose: (finished: boolean) => void;
};

type PanelPos = { top: number; left: number } | 'center';

const HostTutorial: React.FC<HostTutorialProps> = ({ open, stepIndex, onStepChange, onClose }) => {
  const step = HOST_TUTORIAL_STEPS[stepIndex];
  const total = HOST_TUTORIAL_STEPS.length;
  const [spotlight, setSpotlight] = useState<{ top: number; left: number; width: number; height: number } | null>(
    null,
  );
  const [panelPos, setPanelPos] = useState<PanelPos>('center');

  const updateLayout = useCallback(() => {
    if (!open || !step?.target) {
      setSpotlight(null);
      setPanelPos('center');
      return;
    }
    const el = document.querySelector(step.target);
    if (!el || !(el instanceof HTMLElement)) {
      setSpotlight(null);
      setPanelPos('center');
      return;
    }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setSpotlight({
      top: Math.max(8, rect.top - pad),
      left: Math.max(8, rect.left - pad),
      width: Math.min(window.innerWidth - 16, rect.width + pad * 2),
      height: Math.min(window.innerHeight - 16, rect.height + pad * 2),
    });
    const panelTop = rect.bottom + 14;
    if (panelTop + 180 < window.innerHeight) {
      setPanelPos({ top: panelTop, left: Math.min(Math.max(12, rect.left), window.innerWidth - 360) });
    } else if (rect.top > 200) {
      setPanelPos({ top: Math.max(12, rect.top - 190), left: Math.min(Math.max(12, rect.left), window.innerWidth - 360) });
    } else {
      setPanelPos('center');
    }
  }, [open, step?.target]);

  useLayoutEffect(() => {
    if (!open) return;
    updateLayout();
    const t = window.setTimeout(updateLayout, 280);
    return () => window.clearTimeout(t);
  }, [open, stepIndex, updateLayout]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => updateLayout();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, updateLayout]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !step) return null;

  const isFirst = stepIndex <= 0;
  const isLast = stepIndex >= total - 1;

  const panel = (
    <div
      className={`host-tutorial-panel${panelPos === 'center' ? ' host-tutorial-panel--center' : ''}`}
      style={panelPos === 'center' ? undefined : { top: panelPos.top, left: panelPos.left }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-tutorial-title"
    >
      <p className="host-tutorial-panel__progress">
        Step {stepIndex + 1} of {total}
      </p>
      <h2 id="host-tutorial-title" className="host-tutorial-panel__title">
        {step.title}
      </h2>
      <p className="host-tutorial-panel__body">{step.body}</p>
      <div className="host-tutorial-panel__actions">
        <button type="button" className="btn-secondary host-tutorial-panel__skip" onClick={() => onClose(false)}>
          Exit
        </button>
        {!isFirst ? (
          <button type="button" className="btn-secondary" onClick={() => onStepChange(stepIndex - 1)}>
            Back
          </button>
        ) : null}
        {isLast ? (
          <button type="button" className="btn-primary" onClick={() => onClose(true)}>
            Finish
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => onStepChange(stepIndex + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );

  return createPortal(
    <div className="host-tutorial-backdrop" aria-hidden={false}>
      {spotlight ? (
        <div
          className="host-tutorial-spotlight"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      ) : null}
      {panel}
    </div>,
    document.body,
  );
};

export default HostTutorial;
