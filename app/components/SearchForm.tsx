"use client";

import { useEffect, useRef, useState } from "react";
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
  onClear: () => void;
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
  onClear,
  geocoding,
}: SearchFormProps) {
  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // True once a fetch has completed for the current query and returned nothing,
  // so we can show an explicit "no matches" row rather than silence.
  const [noMatches, setNoMatches] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const acAbort = useRef<AbortController | null>(null);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the active suggestion scrolled into view as the user arrows through.
  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function onAddressChange(next: string) {
    onValueChange(next);
    setActiveIdx(-1);
    if (acTimer.current) clearTimeout(acTimer.current);
    if (next.trim().length < 3) {
      acAbort.current?.abort();
      setSuggestions([]);
      setShowSuggestions(false);
      setLoadingSuggestions(false);
      setNoMatches(false);
      return;
    }
    setLoadingSuggestions(true);
    setNoMatches(false);
    setShowSuggestions(true);
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
        setNoMatches(items.length === 0);
        setShowSuggestions(true);
      } catch {
        /* ignore typeahead errors */
      } finally {
        if (acAbort.current === controller) setLoadingSuggestions(false);
      }
    }, 300);
  }

  function clearAddress() {
    if (acTimer.current) clearTimeout(acTimer.current);
    acAbort.current?.abort();
    onValueChange("");
    setSuggestions([]);
    setShowSuggestions(false);
    setLoadingSuggestions(false);
    setNoMatches(false);
    setActiveIdx(-1);
    onClear();
    inputRef.current?.focus();
  }

  function selectSuggestion(item: AutocompleteItem) {
    onValueChange(item.label);
    setSuggestions([]);
    setShowSuggestions(false);
    setNoMatches(false);
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

  const listboxId = "address-suggestions";
  const showDropdown =
    showSuggestions && (loadingSuggestions || noMatches || suggestions.length > 0);

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value, radius);
      }}
    >
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon} aria-hidden>
          🔎
        </span>
        <input
          ref={inputRef}
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
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIdx >= 0 ? `${listboxId}-${activeIdx}` : undefined
          }
        />
        {value && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={clearAddress}
            aria-label="Clear address"
          >
            ×
          </button>
        )}
        {showDropdown && (
          <ul className={styles.suggestions} id={listboxId} role="listbox" ref={listRef}>
            {loadingSuggestions && suggestions.length === 0 && (
              <li className={styles.suggestionStatus} aria-live="polite">
                <span className={styles.suggestionSpinner} aria-hidden /> Searching…
              </li>
            )}
            {!loadingSuggestions && noMatches && (
              <li className={styles.suggestionStatus} aria-live="polite">
                No matches found
              </li>
            )}
            {suggestions.map((s, i) => (
              <li
                key={`${s.label}-${i}`}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className={`${styles.suggestion} ${i === activeIdx ? styles.suggestionActive : ""}`}
                onMouseEnter={() => setActiveIdx(i)}
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

      <div
        className={styles.radiusGroup}
        role="radiogroup"
        aria-label="Search radius"
      >
        {RADIUS_OPTIONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={radius === r}
            className={`${styles.radiusOption} ${radius === r ? styles.radiusOptionActive : ""}`}
            onClick={() => onRadiusChange(r)}
          >
            {(r / 1000).toFixed(0)} km
          </button>
        ))}
      </div>

      <button className={styles.button} type="submit" disabled={geocoding}>
        {geocoding ? "Searching…" : "Show map"}
      </button>
    </form>
  );
}
