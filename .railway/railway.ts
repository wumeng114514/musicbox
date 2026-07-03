import { defineConfig } from "@railway/cli";

export default defineConfig({
  services: {
    musicbox: {
      source: {
        repo: "wumeng114514/musicbox",
        branch: "master",
      },
      build: {
        command: "npm install",
      },
      run: {
        command: "node server.js",
      },
      env: {
        NODE_ENV: "production",
      },
    },
  },
});
