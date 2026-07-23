"use client";

import { useCallback, useEffect, useState } from "react";
import { GROUPS, SUBCATEGORIES, defaultVisibility } from "@/app/lib/categories";
import { readVisibility, writeVisibility } from "@/app/lib/storage";

export interface LayerState {
  // Whether each subcategory's overlay is shown on the map.
  visible: Record<string, boolean>;
  // Whether each group is expanded in the sidebar (second level).
  expanded: Record<string, boolean>;
  // Whether each subcategory's entry list is expanded (third level).
  expandedSubs: Record<string, boolean>;
  toggleSub: (id: string) => void;
  setGroup: (groupId: string, on: boolean) => void;
  setAll: (on: boolean) => void;
  toggleExpand: (groupId: string) => void;
  toggleSubExpand: (subId: string) => void;
}

// Owns the sidebar's layer controls: which overlays are visible (persisted to
// localStorage) and which groups/subcategories are expanded. Visibility starts
// from `defaultVisibility()` for a stable server render, then is reconciled with
// any stored overrides after mount to avoid a hydration mismatch.
export function useLayerState(): LayerState {
  const [visible, setVisible] = useState<Record<string, boolean>>(defaultVisibility);
  // Groups start collapsed so the sidebar stays compact; users expand the
  // categories they care about. Group-level counts are still shown collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.id, false])),
  );
  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});

  // Restore stored visibility once, after mount (localStorage isn't available on
  // the server, so this can't run during render without a hydration mismatch).
  useEffect(() => {
    const stored = readVisibility();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible((v) => ({ ...v, ...stored }));
    }
  }, []);

  // Persist visibility whenever it changes.
  useEffect(() => {
    writeVisibility(visible);
  }, [visible]);

  const toggleSub = useCallback((id: string) => {
    setVisible((v) => ({ ...v, [id]: !v[id] }));
  }, []);

  const setGroup = useCallback((groupId: string, on: boolean) => {
    const subs = GROUPS.find((g) => g.id === groupId)?.subcategories ?? [];
    setVisible((v) => ({ ...v, ...Object.fromEntries(subs.map((s) => [s.id, on])) }));
  }, []);

  const setAll = useCallback((on: boolean) => {
    setVisible(Object.fromEntries(SUBCATEGORIES.map((s) => [s.id, on])));
  }, []);

  const toggleExpand = useCallback((groupId: string) => {
    setExpanded((e) => ({ ...e, [groupId]: !e[groupId] }));
  }, []);

  const toggleSubExpand = useCallback((subId: string) => {
    setExpandedSubs((e) => ({ ...e, [subId]: !e[subId] }));
  }, []);

  return {
    visible,
    expanded,
    expandedSubs,
    toggleSub,
    setGroup,
    setAll,
    toggleExpand,
    toggleSubExpand,
  };
}
