"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface FocusTrapOptions {
  // While true, the trap is armed: Escape closes, Tab cycles within the
  // container, focus moves into the container on activation and returns to the
  // trigger on deactivation. No-op while false.
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  // Element focused when the trap activates (e.g. a drawer's grab handle).
  initialFocusRef: RefObject<HTMLElement | null>;
  // Element focus returns to when the trap deactivates (e.g. the open button).
  returnFocusRef: RefObject<HTMLElement | null>;
  onEscape: () => void;
}

// Accessibility helper for modal-like surfaces (e.g. the mobile bottom-sheet):
// traps Tab focus inside `containerRef`, closes on Escape, moves focus in on
// open and restores it on close. Generic so any dialog can reuse it.
export function useFocusTrap({
  active,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  onEscape,
}: FocusTrapOptions): void {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables =
        containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Move focus into the surface so keyboard users start inside it.
    initialFocusRef.current?.focus();

    // The trigger is stable for the surface's lifetime, so capture it now for
    // cleanup (avoids reading a possibly-changed ref during teardown).
    const returnTarget = returnFocusRef.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTarget?.focus();
    };
  }, [active, containerRef, initialFocusRef, returnFocusRef, onEscape]);
}
