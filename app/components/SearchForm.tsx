"use client";

import { useRef, useState } from "react";
import { RADIUS_OPTIONS } from "@/app/lib/constants";
import { fetchJson } from "@/app/lib/fetchJson";
import type { AutocompleteItem, GeocodeResult } from "@/app/lib/types";
import styles from "../page.module.css";

interface SearchFormProps {
  value: string;
  onValueChange: (value: string) => void;
  radius: number;
  onRadiusChange: (radius: number) => void;
  onSearch: (query: string, radius: number, pre?: GeocodeResult) => void;
  geocoding: boolean;
}

// Address input with debounced autocomplete plus the radius selector. Owns its
// own typeahead state; results are reported to the parent via `onSearch`.
export default function SearchForm({
  value,
  onValueChange,
  radius,
  onRadiusChange,
  onSearch,
  geocoding,
}: SearchFormProps) {
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const acAbort = useRef<AbortController | null>(null);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onAddressChange(next: string) {
    onValueChange(next);
    setActiveIdx(-1);
    if (acTimer.current) clearTimeout(acTimer.current);
    if (next.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    acTimer.current = setTimeout(async () => {
      acAbort.current?.abort();
      const controller = new AbortController();
      acAbort.current = controller;
      try {
        const items = await fetchJson<AutocompleteItem[]>(
          `/api/autocomplete?q=${encodeURIComponent(next.trim())}`,
          controller.signal,
        );
        setSuggestions(items);
        setShowSuggestions(items.length > 0);
      } catch {
        /* ignore typeahead errors */
      }
    }, 300);
  }

  function selectSuggestion(item: AutocompleteItem) {
    onValueChange(item.label);
    setSuggestions([]);
    setShowSuggestions(false);
    onSearch(item.label, radius, { center: item.center, displayName: item.label });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value, radius);
      }}
    >
      <div className={styles.topRow}>
        <div className={styles.searchWrap}>
          <input
            className={styles.input}
            type="text"
            placeholder="e.g. 100 George St, Sydney NSW"
            value={value}
            onChange={(e) => onAddressChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            aria-label="Australian address"
            autoComplete="off"
          />
          {showSuggestions && (
            <ul className={styles.suggestions}>
              {suggestions.map((s, i) => (
                <li
                  key={`${s.label}-${i}`}
                  className={`${styles.suggestion} ${i === activeIdx ? styles.suggestionActive : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(s);
                  }}
                >
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <select
          id="radius"
          className={styles.radiusSelect}
          value={radius}
          onChange={(e) => onRadiusChange(parseInt(e.target.value, 10))}
          aria-label="Search radius"
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {(r / 1000).toFixed(0)} km
            </option>
          ))}
        </select>
      </div>
      <button className={styles.button} type="submit" disabled={geocoding}>
        {geocoding ? "Searching…" : "Show map"}
      </button>
    </form>
  );
}
