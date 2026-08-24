/* Print one of the docs/*.html documents to PDF, exactly as it is styled.

   The agreements, invoices and receipts are authored as HTML with a print
   stylesheet — that is what gives them their typography, their page breaks and
   their tables. Re-drawing them through a PDF library would produce a second,
   poorer document that drifts from the first.

   So this prints the real thing: Electron is already a dependency of the
   project, and Chromium's own print engine is what the HTML was designed for.

   Run:  node scripts/make-doc-pdf.cjs docs/<file>.html [more.html …]
         npx electron scripts/make-doc-pdf.cjs docs/<file>.html            */

const fs   = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

/* Relaunch under Electron when started with plain node — one command works
   either way, which is the point. */
if (!process.versions.electron) {
  const { spawnSync } = require('child_process')
  const electron = require('electron')
  /* ELECTRON_RUN_AS_NODE has to be REMOVED, not blanked: Electron tests
     whether the variable exists, so an empty value still boots it as plain
     node and `app` comes back undefined. */
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const res = spawnSync(electron, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(res.status ?? 1)
}

const { app, BrowserWindow } = require('electron')

const files = process.argv.slice(2).filter(a => a.endsWith('.html'))
if (files.length === 0) {
  console.error('Usage: node scripts/make-doc-pdf.cjs docs/<file>.html [...]')
  process.exit(1)
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  for (const rel of files) {
    const src = path.isAbsolute(rel) ? rel : path.join(ROOT, rel)
    if (!fs.existsSync(src)) { console.error('missing:', rel); continue }
    const out = src.replace(/\.html$/i, '.pdf')

    const win = new BrowserWindow({ show: false, width: 1240, height: 1754 })
    /* Chromium occasionally refuses a second file:// load in the same session
       with ERR_FAILED, right after the previous window was destroyed. One
       retry after a beat is enough, and is cheaper than failing a batch. */
    try {
      await win.loadFile(src)
    } catch (e) {
      await new Promise(r => setTimeout(r, 400))
      await win.loadFile(src)
    }
    // Give webfonts and any @print rules a moment to settle before capture.
    await new Promise(r => setTimeout(r, 1200))

    const pdf = await win.webContents.printToPDF({
      printBackground: true,          // the documents are designed with colour
      pageSize: 'A4',
      margins: { marginType: 'none' },  // the HTML carries its own page margins
      preferCSSPageSize: true,
    })
    fs.writeFileSync(out, pdf)
    win.destroy()
    await new Promise(r => setTimeout(r, 250))     // let the window go before the next
    console.log(`${path.basename(out)}  ${(pdf.length / 1024).toFixed(0)} KB`)
  }
  app.quit()
}).catch(e => { console.error(e); app.quit() })
