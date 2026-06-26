import { useEffect } from "react";
import { useCanvasStore } from "../state/store";

/**
 * Non-invasive toast that surfaces the most recent dev-server URL detected in a
 * terminal. Auto-dismisses after 10s; clicking "Open" loads it in the preview
 * dock and consumes the suggestion.
 */
export default function PreviewSuggestionToast() {
  const suggestions = useCanvasStore((s) => s.previewSuggestions);
  const dismiss = useCanvasStore((s) => s.dismissPreviewSuggestion);
  const openPreview = useCanvasStore((s) => s.openPreview);
  const setPreviewOpen = useCanvasStore((s) => s.setPreviewOpen);

  // Only show the head of the queue (oldest unhandled suggestion).
  const current = suggestions[0] ?? null;

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => dismiss(current.id), 10000);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  if (!current) return null;

  const accept = () => {
    openPreview(current.url, current.terminalId);
    setPreviewOpen(true);
    dismiss(current.id);
  };

  return (
    <div className="preview-toast" role="status" aria-live="polite">
      <div className="preview-toast__icon" aria-hidden="true">🔗</div>
      <div className="preview-toast__content">
        <div className="preview-toast__title">Dev server ready</div>
        <div className="preview-toast__detail">
          <span className="preview-toast__term">{current.terminalTitle}</span>
          <span className="preview-toast__url">{current.url}</span>
        </div>
      </div>
      <div className="preview-toast__actions">
        <button className="preview-toast__btn preview-toast__btn--primary" onClick={accept}>
          Open preview
        </button>
        <button
          className="preview-toast__btn preview-toast__btn--ghost"
          onClick={() => dismiss(current.id)}
          aria-label="Dismiss"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}
