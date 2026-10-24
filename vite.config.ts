import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { chunkSizeWarningLimit: 1800 },
  server: { host: "127.0.0.1", watch: { ignored: ["**/artifacts/**"] } },
});
