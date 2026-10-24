import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径：部署在 GitHub Pages 子路径（/cloud-office/）或任意目录下都能加载；路由用 hash，不依赖服务端
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
