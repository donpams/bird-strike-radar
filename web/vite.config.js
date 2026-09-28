import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this repo at https://donpams.github.io/bird-strike-radar/
export default defineConfig({
  plugins: [react()],
  base: "/bird-strike-radar/",
});
