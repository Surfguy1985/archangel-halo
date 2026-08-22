import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5177,
    proxy: {
      "/api": {
        target: process.env.HALO_API_PROXY || "https://archangel-halo.replit.app",
        changeOrigin: true,
      },
    },
  },
});
