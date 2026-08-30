import { defineConfig } from 'vite'

export default defineConfig({
  base: '/ghostball/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
