const { defineConfig } = require('vite')
const react = require('@vitejs/plugin-react').default
const path  = require('path')

module.exports = defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
