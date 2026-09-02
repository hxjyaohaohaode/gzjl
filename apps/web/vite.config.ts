import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5_173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: false,
      },
      "/healthz": {
        target: "http://localhost:3000",
        changeOrigin: false,
      },
      "/readyz": {
        target: "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
  build: {
    sourcemap: true,
    target: "es2022",
  },
});
