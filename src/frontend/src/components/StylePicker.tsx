import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * The style box on the record screen: type to search, arrow to choose.
 *
 * This started as a native `<input list>` + `<datalist>`, which is the right
 * first answer — the browser does type-ahead, keyboard and accessibility for
 * free. It caps out on exactly one thing, and it is the thing that was asked
 * for next: **a datalist's panel is drawn by the browser.** Its width, its row
 * height, its type and whether it shows anything at all before you type are
 * all outside CSS. So the panel is ours now, and everything a datalist gave
 * away for free has to be paid for here — which is what the keyboard handling
 * and the aria wiring below are.
 *
 * What it is worth paying for:
 *
 *  - **Width.** A datalist panel tracks the input, and the input was 240px
 *    because it held a style number. The panel needs more room than the field.
 *  - **The match, shown.** Typing `72` marks the `72` inside `7270`, so the
 *    operator can see *why* a row is in the list rather than re-reading seven
 *    numbers that all start alike.
 *  - **The default as a row.** "Style announced in the recording" is a real
 *    answer, not an empty field, and a datalist cannot offer it — a datalist
 *    only ever suggests values, so the default had to live in a placeholder
 *    nobody reads.
 *
 * Numbers only, deliberately. The description lives behind
 * `GET /api/style-sets/sheets`, which parses every PDF in the library; this
 * screen is on the path to starting an inspection and must never wait on a
 * parser. See `library()` in api/app.py.
 */

interface Props {
  /** Every style number with a sheet, or null while the library is loading. */
  library: string[] | null;
  /** The raw text in the box. "" means "use the style the recording announces". */
  value: string;
  onChange: (value: string) => void;
  /** Set when the text is not "" and matches no sheet. */
  invalid: boolean;
  /** Why the library could not be read, if it could not. */
  error?: string;
}

/**
 * How many rows the panel holds.
 *
 * It scrolls past this; the cap is on what is rendered, because a list of four
 * thousand nodes costs the browser real time on every keystroke. Nobody reads
 * past the first screen of a list they are typing to narrow.
 */
const MAX_ROWS = 50;

/** The match, marked inside the row, so it is clear why the row is here. */
function Marked({ style, needle }: { style: string; needle: string }) {
  const at = needle ? style.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return <>{style}</>;
  return (
    <>
      {style.slice(0, at)}
      <mark>{style.slice(at, at + needle.length)}</mark>
      {style.slice(at + needle.length)}
    </>
  );
}

export function StylePicker({ library, value, onChange, invalid, error }: Props) {
  const [open, setOpen] = useState(false);
  /** Which row the keyboard is on. -1 is the "announced in the recording" row. */
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const all = library ?? [];
  const needle = value.trim().toLowerCase();
  const matches = useMemo(() => {
    // Off `library`, not off `all` — the `?? []` above builds a fresh array on
    // every render, which would make this memo hold nothing.
    const sheets = library ?? [];
    const found = needle
      ? sheets.filter((style) => style.toLowerCase().includes(needle))
      : sheets;
    return found.slice(0, MAX_ROWS);
  }, [needle, library]);

  // Clicking away is how a picker is dismissed; without it the panel follows
  // the operator down the form.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (style: string) => {
    onChange(style);
    setOpen(false);
    setCursor(-1);
    field.current?.focus();
  };

  /** -1 is the default row, then 0..n-1 are the styles. */
  const rows = matches.length + 1;

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      setCursor(-1);
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      choose(cursor < 0 ? "" : matches[cursor]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      // Wraps, counting the default row as the one before the first style.
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (cursor + 1 + step + rows) % rows;
      setCursor(next - 1);
    }
  }

  const activeId =
    open && cursor >= 0 ? `${listId}-${cursor}` : open && cursor === -1 ? `${listId}-any` : undefined;

  return (
    <div className="stylepick" ref={box}>
      <input
        ref={field}
        id="style"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        // Off, or the browser's own saved-values panel opens on top of ours.
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Style announced in the recording"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setCursor(-1);
        }}
        // Click, not focus. `choose` puts focus back on the field so the next
        // keystroke lands there, and opening on focus meant every pick
        // re-opened the panel it had just closed. A keyboard user opens it
        // with the arrow keys, which is what a combobox is expected to do.
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="stylepick-toggle"
        tabIndex={-1}
        aria-label={open ? "Hide the style list" : "Show the style list"}
        onClick={() => {
          setOpen((was) => !was);
          field.current?.focus();
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <polyline
            points="6 9 12 15 18 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul className="stylepick-list" id={listId} role="listbox" aria-label="Style sets">
          {/* The default, as a row. Leaving the box empty does the same thing,
              but an operator who has typed something needs somewhere to go
              back to that is not "delete what you typed". */}
          <li
            id={`${listId}-any`}
            role="option"
            aria-selected={value.trim() === ""}
            className={`any${cursor === -1 ? " at" : ""}`}
            onMouseEnter={() => setCursor(-1)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose("")}
          >
            Style announced in the recording
            <em>graded against whichever style the inspector reads out</em>
          </li>

          {library === null ? (
            <li className="note">Reading the library…</li>
          ) : all.length === 0 ? (
            <li className="note">{error || "No sheets in the library yet"}</li>
          ) : matches.length === 0 ? (
            <li className="note">
              No sheet matches <b>{value.trim()}</b>
            </li>
          ) : (
            matches.map((style, index) => (
              <li
                key={style}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={style === value.trim()}
                className={cursor === index ? "at" : undefined}
                onMouseEnter={() => setCursor(index)}
                // Or the input blurs before the click lands and the panel is
                // already gone by the time the row is released.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(style)}
              >
                <b>
                  <Marked style={style} needle={value.trim()} />
                </b>
              </li>
            ))
          )}

          {all.length > matches.length && needle === "" && (
            <li className="note">
              {all.length - matches.length} more · type to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
