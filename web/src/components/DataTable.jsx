import { useMemo, useState } from "react";
import { ArrowUpDown, X } from "lucide-react";
import { relColor, fmtInt, fmtRate, fmtRel, isDistinct, MONTHS_LONG, RISK_COLORS } from "../scale.js";

const COLS = [
  { key: "icao", label: "Airport", get: (a) => a.icao },
  { key: "name", label: "Name", get: (a) => a.name },
  { key: "r", label: "Est. per 10k ops", get: (a, m) => m.r, num: true },
  { key: "ci", label: "90% interval", get: (a, m) => m.lo, num: true },
  { key: "rel", label: "vs national", get: (a, m) => m.rel, num: true },
  { key: "raw", label: "Raw per 10k", get: (a, m) => m.raw, num: true },
  { key: "d", label: "Damaging", get: (a, m) => m.d, num: true },
  { key: "n", label: "Reports", get: (a, m) => m.n, num: true },
  { key: "risk", label: "882E risk", get: (a, m) => ["Low", "Medium", "Serious", "High"].indexOf(m.risk), num: true },
];

export default function DataTable({ data, month, onClose, onPick }) {
  const [sort, setSort] = useState({ key: "r", desc: true });
  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key);
    return [...data.airports].sort((a, b) => {
      const x = col.get(a, a.m[month]);
      const y = col.get(b, b.m[month]);
      const cmp = col.num ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -cmp : cmp;
    });
  }, [data, month, sort]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Data table" onClick={onClose}>
      <div className="card table-card" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>All study airports, {MONTHS_LONG[month]}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close table"><X size={18} /></button>
        </header>
        <p className="muted small">
          Damaging strikes per 10,000 operations, {data.meta.years[0]}-{data.meta.years[1]}. Click a row to show it on
          the map. Estimates marked &#9675; are not distinguishable from the national rate.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className={c.num ? "num" : ""}>
                    <button onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !!c.num }))}>
                      {c.label} <ArrowUpDown size={12} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const m = a.m[month];
                return (
                  <tr key={a.icao} onClick={() => onPick(a.icao)}>
                    <td>{a.icao}</td>
                    <td className="name">{a.name}</td>
                    <td className="num">
                      <i className="dot" style={{ background: relColor(m.rel) }} />
                      {fmtRate(m.r)} {isDistinct(m) ? "" : "○"}
                    </td>
                    <td className="num">{fmtRate(m.lo)}-{fmtRate(m.hi)}</td>
                    <td className="num">{fmtRel(m.rel)}</td>
                    <td className="num">{fmtRate(m.raw)}</td>
                    <td className="num">{fmtInt(m.d)}</td>
                    <td className="num">{fmtInt(m.n)}</td>
                    <td className="num"><span className="chip" style={{ "--c": RISK_COLORS[m.risk] }}>{m.risk}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
