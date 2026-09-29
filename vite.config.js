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
    /* The installer build writes hundreds of megabytes into release/ and holds
       its temp files locked; a dev server watching them crashed with EBUSY the
       moment an installer was built beside it. Nothing the page loads lives
       in either folder. */
    watch: { ignored: ['**/release/**', '**/dist/**'] },
  },
})
