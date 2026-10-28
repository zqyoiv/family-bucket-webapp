import { useEffect } from "react";

const EDITABLE = "input, textarea, [contenteditable='true']";

function isEditable(target) {
  return target instanceof Element && Boolean(target.closest(EDITABLE));
}

/**
 * Guest phone pages (/vrbo-ip1..3): no text selection, no Copy / Look Up / Share callout,
 * no long-press menu, no image drag-save. Typing in the name field still works.
 * CSS does most of it (see `.vrbo-v2-device--phone` in vrbo-v2.css); this is the JS backstop
 * for iOS paths CSS alone does not stop (long-press menu, copy shortcut, stray selections).
 */
export default function useVrboNoTextSelection(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;

    const block = (event) => event.preventDefault();
    const blockUnlessEditable = (event) => {
      if (isEditable(event.target)) return;
      event.preventDefault();
    };
    const dropSelection = () => {
      const active = document.activeElement;
      if (active instanceof Element && active.matches(EDITABLE)) return;
      const selection = window.getSelection?.();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    };

    // Long-press / right-click menu (Copy, Look Up, Share, Save Image…) — everywhere, inputs too.
    document.addEventListener("contextmenu", block, { capture: true });
    document.addEventListener("copy", block, { capture: true });
    document.addEventListener("cut", block, { capture: true });
    document.addEventListener("dragstart", block, { capture: true });
    document.addEventListener("selectstart", blockUnlessEditable, { capture: true });
    document.addEventListener("selectionchange", dropSelection);

    return () => {
      document.removeEventListener("contextmenu", block, { capture: true });
      document.removeEventListener("copy", block, { capture: true });
      document.removeEventListener("cut", block, { capture: true });
      document.removeEventListener("dragstart", block, { capture: true });
      document.removeEventListener("selectstart", blockUnlessEditable, { capture: true });
      document.removeEventListener("selectionchange", dropSelection);
    };
  }, [enabled]);
}
