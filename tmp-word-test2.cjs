const { app, BrowserWindow } = require('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1320, height: 860, show: true, x: 40, y: 30 })
  const js = (code) => win.webContents.executeJavaScript(code)

  try {
    await win.loadURL('http://localhost:5174/#/search?q=Shape%20of%20You')
    await sleep(3400)
    await js("document.querySelector('.track-table .row').click()")
    await sleep(4000)
    await js("location.hash = '#/lyrics'")
    await sleep(2600)

    console.log('STATE ' + JSON.stringify(await js(`(() => ({
      source: document.querySelector('.lyric-page__actions .pill')?.textContent ?? null,
      activeCount: document.querySelectorAll('.lyric-line--active').length,
      activeText: document.querySelector('.lyric-line--active')?.textContent.trim().slice(0, 40) ?? null,
      activeWords: document.querySelectorAll('.lyric-line--active .lyric-line__word').length,
      activePlain: !!document.querySelector('.lyric-line--active .lyric-line__text'),
      playing: document.querySelector('.icon-button[title*="暂停"]') ? true : null,
      hint: document.querySelector('.lyric-page__hint-title')?.textContent ?? null,
      stage: document.querySelector('.lyric-page__stage')?.innerText.slice(0, 160) ?? null,
    }))()`)))

    // 等两秒再看一次（播放推进后应切换当前行）
    await sleep(2500)
    console.log('LATER ' + JSON.stringify(await js(`(() => ({
      activeText: document.querySelector('.lyric-line--active')?.textContent.trim().slice(0, 40) ?? null,
      activeWords: document.querySelectorAll('.lyric-line--active .lyric-line__word').length,
      activePlain: !!document.querySelector('.lyric-line--active .lyric-line__text'),
    }))()`)))
  } catch (e) {
    console.log('FAIL ' + String(e))
  } finally {
    await sleep(300)
    app.quit()
  }
})
