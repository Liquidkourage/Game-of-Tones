import React, { useEffect, useState } from 'react';
import { Megaphone, Eye, EyeOff } from 'lucide-react';

export type SponsorScreenConfig = {
  mediaUrl: string;
  text: string;
  qrUrl: string;
  mediaKind: 'image' | 'video';
  visible: boolean;
};

type HostSponsorScreenPanelProps = {
  config: SponsorScreenConfig;
  canShow: boolean;
  onSave: (next: Omit<SponsorScreenConfig, 'visible'>) => void;
  onSetVisible: (visible: boolean) => void;
  className?: string;
};

function detectMediaKind(url: string, explicit: 'image' | 'video'): 'image' | 'video' {
  if (explicit === 'video') return 'video';
  if (explicit === 'image') return 'image';
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ? 'video' : 'image';
}

const HostSponsorScreenPanel: React.FC<HostSponsorScreenPanelProps> = ({
  config,
  canShow,
  onSave,
  onSetVisible,
  className,
}) => {
  const [mediaUrl, setMediaUrl] = useState(config.mediaUrl);
  const [text, setText] = useState(config.text);
  const [qrUrl, setQrUrl] = useState(config.qrUrl);
  const [mediaKind, setMediaKind] = useState<'image' | 'video'>(config.mediaKind);

  useEffect(() => {
    setMediaUrl(config.mediaUrl);
    setText(config.text);
    setQrUrl(config.qrUrl);
    setMediaKind(config.mediaKind);
  }, [config.mediaUrl, config.text, config.qrUrl, config.mediaKind]);

  const hasContent = Boolean(mediaUrl.trim() || text.trim() || qrUrl.trim());
  const showDisabled = !canShow || !hasContent;

  const persist = (patch: Partial<Omit<SponsorScreenConfig, 'visible'>>) => {
    const nextUrl = patch.mediaUrl !== undefined ? patch.mediaUrl : mediaUrl;
    const nextKind =
      patch.mediaKind !== undefined
        ? patch.mediaKind
        : detectMediaKind(nextUrl.trim(), mediaKind);
    onSave({
      mediaUrl: nextUrl.trim(),
      text: (patch.text !== undefined ? patch.text : text).trim(),
      qrUrl: (patch.qrUrl !== undefined ? patch.qrUrl : qrUrl).trim(),
      mediaKind: nextKind,
    });
  };

  return (
    <section
      className={['host-sponsor-screen host-glass-panel', className].filter(Boolean).join(' ')}
      aria-label="Sponsor screen"
    >
      <div className="host-sponsor-screen__header">
        <h2 className="host-sponsor-screen__title">
          <Megaphone className="host-sponsor-screen__icon" aria-hidden />
          Sponsor screen
        </h2>
        <p className="host-sponsor-screen__summary">
          Between rounds only — never during a live call list.
        </p>
      </div>

      <label className="host-sponsor-screen__field">
        <span className="host-sponsor-screen__label">Media URL (image or video)</span>
        <input
          type="url"
          className="host-sponsor-screen__input"
          placeholder="https://…"
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          onBlur={() => persist({ mediaUrl })}
        />
      </label>

      <div className="host-sponsor-screen__kind" role="group" aria-label="Media type">
        <button
          type="button"
          className={
            mediaKind === 'image'
              ? 'host-sponsor-screen__kind-btn host-sponsor-screen__kind-btn--on'
              : 'host-sponsor-screen__kind-btn'
          }
          onClick={() => {
            setMediaKind('image');
            persist({ mediaKind: 'image' });
          }}
        >
          Image
        </button>
        <button
          type="button"
          className={
            mediaKind === 'video'
              ? 'host-sponsor-screen__kind-btn host-sponsor-screen__kind-btn--on'
              : 'host-sponsor-screen__kind-btn'
          }
          onClick={() => {
            setMediaKind('video');
            persist({ mediaKind: 'video' });
          }}
        >
          Video
        </button>
      </div>

      <label className="host-sponsor-screen__field">
        <span className="host-sponsor-screen__label">Text</span>
        <textarea
          className="host-sponsor-screen__textarea"
          rows={2}
          maxLength={280}
          placeholder="Tonight’s prizes by…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => persist({ text })}
        />
      </label>

      <label className="host-sponsor-screen__field">
        <span className="host-sponsor-screen__label">QR link (optional)</span>
        <input
          type="url"
          className="host-sponsor-screen__input"
          placeholder="https://… (shown as QR on projector)"
          value={qrUrl}
          onChange={(e) => setQrUrl(e.target.value)}
          onBlur={() => persist({ qrUrl })}
        />
      </label>

      <div className="host-sponsor-screen__actions">
        {config.visible ? (
          <button
            type="button"
            className="btn-secondary host-sponsor-screen__toggle"
            onClick={() => onSetVisible(false)}
          >
            <EyeOff className="w-4 h-4" aria-hidden />
            Hide sponsor
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary host-sponsor-screen__toggle"
            onClick={() => {
              persist({});
              onSetVisible(true);
            }}
            disabled={showDisabled}
            title={
              !canShow
                ? 'Only available between rounds'
                : !hasContent
                  ? 'Add media, text, or a QR link first'
                  : 'Show on projector'
            }
          >
            <Eye className="w-4 h-4" aria-hidden />
            Show sponsor
          </button>
        )}
        {!canShow ? (
          <span className="host-sponsor-screen__hint">Unavailable while a round is live.</span>
        ) : null}
      </div>
    </section>
  );
};

export default HostSponsorScreenPanel;
