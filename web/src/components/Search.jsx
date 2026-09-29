import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";

// Find an airport by ICAO ("KDEN"), 3-letter code ("DEN"), name or city. Press "/" to focus.
export default function Search({ airports, onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef(null);

  const index = useMemo(
    () =>
      airports.map((a) => ({
        a,
        hay: `${a.icao} ${a.icao.length === 4 && a.icao[0] === "K" ? a.icao.slice(1) : ""} ${a.name} ${a.city} ${a.state}`.toLowerCase(),
      })),
    [airports],
  );

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const scored = index
      .map(({ a, hay }) => {
        const code = a.icao.toLowerCase();
        const score =
          code === s || code.slice(1) === s ? 0 : code.startsWith(s) || code.slice(1).startsWith(s) ? 1 : hay.includes(` ${s}`) ? 2 : hay.includes(s) ? 3 : 9;
        return { a, score };
      })
      .filter((r) => r.score < 9)
      .sort((x, y) => x.score - y.score || y.a.opsYear - x.a.opsYear);
    return scored.slice(0, 6).map((r) => r.a);
  }, [q, index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (a) => {
    onPick(a.icao);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="glass search" role="search">
      <SearchIcon size={15} strokeWidth={1.8} />
      <input
        ref={input}
        value={q}
        placeholder="Find an airport"
        aria-label="Find an airport by code, name or city"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, results.length - 1));
          if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
          if (e.key === "Enter" && results[hi]) pick(results[hi]);
          if (e.key === "Escape") {
            setQ("");
            input.current?.blur();
          }
        }}
      />
      <kbd>/</kbd>
      {open && results.length > 0 && (
        <ul className="glass results" role="listbox">
          {results.map((a, i) => (
            <li
              key={a.icao}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? "hi" : ""}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
            >
              <span className="code">{a.icao}</span>
              <span className="nm">{a.name}</span>
              <span className="loc">{a.city}, {a.state}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
