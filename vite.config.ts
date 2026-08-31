import { defineConfig } from "vite";

// mbg-data/ holds the (gitignored) game assets; serve it as static files at
// /mbg-data without copying anything into the build output.
export default defineConfig({
  publicDir: "public",
  server: {
    port: 8372,
    fs: {
      allow: ["."],
    },
  },
});
