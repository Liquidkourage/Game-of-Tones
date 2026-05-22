import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X } from 'lucide-react';
import './HostScreenTour.css';

export type HostTourStep = {
  id: string;
  title: string;
  body: string;
  /** When false, step is skipped (element may be hidden). */
  visible?: boolean;
  placement?: 'top' | 'bottom' | 'left' | 'right';
};

export type HostScreenTourProps = {
  open: boolean;
  stepIndex: number;
  steps: HostTourStep[];
  onStepIndexChange: (index: number) => void;
  onClose: () => void;
};

type BubblePos = {
  top: number;
  left: number;
  placement: 'top' | 'bottom' | 'left' | 'right';
};

const BUBBLE_GAP = 14;
const VIEWPORT_PAD = 12;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function computeBubblePos(
  rect: DOMRect,
  placement: HostTourStep['placement'],
  bubbleW: number,
  bubbleH: number,
): BubblePos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let place = placement ?? 'bottom';

  const tryBottom = () => ({
    top: rect.bottom + BUBBLE_GAP,
    left: clamp(rect.left + rect.width / 2 - bubbleW / 2, VIEWPORT_PAD, vw - bubbleW - VIEWPORT_PAD),
    placement: 'bottom' as const,
  });
  const tryTop = () => ({
    top: rect.top - bubbleH - BUBBLE_GAP,
    left: clamp(rect.left + rect.width / 2 - bubbleW / 2, VIEWPORT_PAD, vw - bubbleW - VIEWPORT_PAD),
    placement: 'top' as const,
  });
  const tryRight = () => ({
    top: clamp(rect.top + rect.height / 2 - bubbleH / 2, VIEWPORT_PAD, vh - bubbleH - VIEWPORT_PAD),
    left: rect.right + BUBBLE_GAP,
    placement: 'right' as const,
  });
  const tryLeft = () => ({
    top: clamp(rect.top + rect.height / 2 - bubbleH / 2, VIEWPORT_PAD, vh - bubbleH - VIEWPORT_PAD),
    left: rect.left - bubbleW - BUBBLE_GAP,
    placement: 'left' as const,
  });

  const candidates: Array<() => BubblePos> =
    place === 'top'
      ? [tryTop, tryBottom, tryRight, tryLeft]
      : place === 'left'
        ? [tryLeft, tryRight, tryBottom, tryTop]
        : place === 'right'
          ? [tryRight, tryLeft, tryBottom, tryTop]
          : [tryBottom, tryTop, tryRight, tryLeft];

  for (const fn of candidates) {
    const p = fn();
    if (
      p.top >= VIEWPORT_PAD &&
      p.left >= VIEWPORT_PAD &&
      p.top + bubbleH <= vh - VIEWPORT_PAD &&
      p.left + bubbleW <= vw - VIEWPORT_PAD
    ) {
      return p;
    }
  }
  return tryBottom();
}

const HostScreenTour: React.FC<HostScreenTourProps> = ({
  open,
  stepIndex,
  steps,
  onStepIndexChange,
  onClose,
}) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [bubblePos, setBubblePos] = useState<BubblePos | null>(null);

  const step = steps[stepIndex];
  const total = steps.length;
  const isFirst = stepIndex <= 0;
  const isLast = stepIndex >= total - 1;

  const measure = useCallback(() => {
    if (!open || !step) {
      setTargetRect(null);
      setBubblePos(null);
      return;
    }
    const el = document.querySelector(`[data-host-tour="${step.id}"]`);
    if (!el) {
      setTargetRect(null);
      setBubblePos(null);
      return;
    }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    setTargetRect(rect);
    const bubble = bubbleRef.current;
    const bw = bubble?.offsetWidth ?? 320;
    const bh = bubble?.offsetHeight ?? 160;
    setBubblePos(computeBubblePos(rect, step.placement, bw, bh));
  }, [open, step]);

  useLayoutEffect(() => {
    measure();
  }, [measure, stepIndex]);

  useEffect(() => {
    if (open) {
      document.body.classList.add('host-tour-active');
    } else {
      document.body.classList.remove('host-tour-active');
    }
    return () => document.body.classList.remove('host-tour-active');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onLayout = () => measure();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    const t = window.setTimeout(measure, 380);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      window.clearTimeout(t);
    };
  }, [open, measure]);

  useEffect(() => {
    document.querySelectorAll('[data-host-tour].host-screen-tour-target').forEach((el) => {
      el.classList.remove('host-screen-tour-target');
    });
    if (!open || !step) return;
    const el = document.querySelector(`[data-host-tour="${step.id}"]`);
    el?.classList.add('host-screen-tour-target');
    return () => {
      el?.classList.remove('host-screen-tour-target');
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' && !isLast) {
        e.preventDefault();
        onStepIndexChange(stepIndex + 1);
      } else if (e.key === 'ArrowLeft' && !isFirst) {
        e.preventDefault();
        onStepIndexChange(stepIndex - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isFirst, isLast, onClose, onStepIndexChange, stepIndex]);

  if (!open || !step || total === 0) return null;

  return createPortal(
    <div className="host-screen-tour" role="presentation">
      <button
        type="button"
        className="host-screen-tour__backdrop"
        aria-label="Close tour"
        onClick={onClose}
      />
      {targetRect ? (
        <div
          className="host-screen-tour__spotlight"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
          aria-hidden
        />
      ) : null}
      <div
        ref={bubbleRef}
        className={`host-screen-tour__bubble${bubblePos ? ` host-screen-tour__bubble--${bubblePos.placement}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-screen-tour-title"
        aria-describedby="host-screen-tour-body"
        style={
          bubblePos
            ? { top: bubblePos.top, left: bubblePos.left }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        }
      >
        <div className="host-screen-tour__bubble-header">
          <HelpCircle className="host-screen-tour__avatar" aria-hidden />
          <div className="host-screen-tour__bubble-meta">
            <span className="host-screen-tour__step-count">
              {stepIndex + 1} of {total}
            </span>
            <button type="button" className="host-screen-tour__close" aria-label="Close tour" onClick={onClose}>
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
        <h2 id="host-screen-tour-title" className="host-screen-tour__title">
          {step.title}
        </h2>
        <p id="host-screen-tour-body" className="host-screen-tour__body">
          {step.body}
        </p>
        {!targetRect ? (
          <p className="host-screen-tour__missing">This part isn&apos;t visible right now — use Next to continue.</p>
        ) : null}
        <div className="host-screen-tour__actions">
          <button type="button" className="btn-secondary host-screen-tour__btn" disabled={isFirst} onClick={() => onStepIndexChange(stepIndex - 1)}>
            Back
          </button>
          {isLast ? (
            <button type="button" className="btn-primary host-screen-tour__btn host-screen-tour__btn--done" onClick={onClose}>
              Done
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary host-screen-tour__btn"
              onClick={() => onStepIndexChange(stepIndex + 1)}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default HostScreenTour;
