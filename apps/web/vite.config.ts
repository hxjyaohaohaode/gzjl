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
        ws: true,
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
    // Keep the browser's cache units aligned with stable product capabilities.
    // Vite 8 uses Rolldown's native code-splitting API; this deliberately avoids
    // the deprecated Rollup `manualChunks` compatibility layer.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-runtime",
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 50,
            },
            {
              name: "routing",
              test: /[\\/]node_modules[\\/]react-router(?:-dom)?[\\/]/,
              priority: 40,
            },
            {
              name: "data-client",
              test: /[\\/]node_modules[\\/]@tanstack[\\/]/,
              priority: 40,
            },
            {
              name: "ui-foundations",
              test: /[\\/]node_modules[\\/](?:tailwind-merge|class-variance-authority|clsx)[\\/]/,
              priority: 30,
            },
            {
              name: "motion",
              test: /[\\/]node_modules[\\/](?:motion|framer-motion)[\\/]/,
              priority: 30,
            },
            {
              name: "canvas-flow",
              test: /[\\/]node_modules[\\/]@xyflow[\\/]/,
              priority: 30,
            },
            {
              // ECharts is already lazy at the route level. Split its internal
              // modules too so an analytics visit never requires one oversized
              // cache asset on a cold or mobile connection.
              name: "analytics-engine",
              test: /[\\/]node_modules[\\/]echarts[\\/]/,
              priority: 30,
              // The limit is based on Rolldown's module-size heuristic rather
              // than the final gzip size. 768 KiB yields a small handful of
              // cacheable analytics chunks, instead of either one 500+ KiB
              // payload or dozens of tiny HTTP requests.
              maxSize: 768 * 1024,
            },
          ],
        },
      },
    },
  },
});
