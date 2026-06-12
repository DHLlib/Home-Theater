import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^ckplayer$/,
        replacement: path.resolve(__dirname, "node_modules/ckplayer/js/ckplayer.js"),
      },
    ],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/react\//.test(id) ||
              /node_modules\/react-dom\//.test(id) ||
              /node_modules\/react-router-dom\//.test(id)) {
            return "react-vendor";
          }
          if (/node_modules\/xgplayer/.test(id)) {
            return "player-vendor";
          }
          if (/node_modules\/framer-motion/.test(id)) {
            return "ui-vendor";
          }
        },
      },
    },
  },
});
