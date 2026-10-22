const { app, BrowserWindow } = require('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1320, height: 860, show: true, x: 40, y: 30 })
  const js = (code) => win.webContents.executeJavaScript(code)
  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(String(message).slice(0, 200))
  })

  try {
    await win.loadURL('http://localhost:5174/#/search?q=Shape%20of%20You')
    await sleep(3400)
    console.log('BEFORE ' + JSON.stringify(await js("({ hash: location.hash, rows: document.querySelectorAll('.track-table .row').length })")))

    await js("document.querySelector('.track-table .row').click()")
    await sleep(4000)
    console.log('PLAYED ' + JSON.stringify(await js("({ now: document.querySelector('.now__title')?.textContent ?? null })")))

    await js("location.hash = '#/lyrics'")
    await sleep(3000)
    console.log('AFTER ' + JSON.stringify(await js(`({
      hash: location.hash,
      hasPage: !!document.querySelector('.lyric-page'),
      stage: !!document.querySelector('.lyric-page__stage'),
      body: document.body.innerText.slice(0, 120).replace(/\\s+/g, ' '),
    })`)))
    console.log('ERRORS ' + JSON.stringify(errors.slice(0, 5)))
  } catch (e) {
    console.log('FAIL ' + String(e))
  } finally {
    await sleep(300)
    app.quit()
  }
})
