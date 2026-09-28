import { useEffect, useState } from "react";

// Theme preference: "light", "dark", or "auto" (follows the viewer's local clock:
// day 07:00-19:00, night otherwise). Stored per browser; the page works without storage.
const KEY = "bsr-theme";
const DAY_START = 7;
const DAY_END = 19;

const read = () => {
  try {
    return localStorage.getItem(KEY) || "auto";
  } catch {
    return "auto";
  }
};
const clockTheme = () => {
  const h = new Date().getHours();
  return h >= DAY_START && h < DAY_END ? "light" : "dark";
};

export function useTheme() {
  const [mode, setMode] = useState(read);
  const [clock, setClock] = useState(clockTheme);

  // Re-check the clock every minute so "auto" flips at dusk and dawn on its own
  useEffect(() => {
    const t = setInterval(() => setClock(clockTheme()), 60_000);
    return () => clearInterval(t);
  }, []);

  const theme = mode === "auto" ? clock : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* private mode etc. - fine */
    }
  }, [theme, mode]);

  const cycle = () => setMode((m) => (m === "auto" ? "light" : m === "light" ? "dark" : "auto"));
  return { mode, theme, cycle };
}
