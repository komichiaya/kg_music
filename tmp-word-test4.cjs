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

    // 走真实入口：点播放栏封面进歌词页
    await js("(() => { const b = document.querySelector('.now__cover'); if (b) b.click(); return !!b; })()")
    await sleep(3000)

    console.log('PAGE ' + JSON.stringify(await js(`({
      hash: location.hash,
      hasPage: !!document.querySelector('.lyric-page'),
      source: document.querySelector('.lyric-page__actions .pill')?.textContent ?? null,
      lines: document.querySelectorAll('.lyric-line').length,
      activeWords: document.querySelectorAll('.lyric-line--active .lyric-line__word').length,
      activeText: document.querySelector('.lyric-line--active')?.textContent.trim().slice(0, 50) ?? null,
    })`)))

    // 采样逐字填充
    const samples = await js(`(async () => {
      const out = [];
      for (let i = 0; i < 20; i += 1) {
        const w = document.querySelector('.lyric-line--active .lyric-line__word');
        out.push(w ? getComputedStyle(w).backgroundSize : 'none');
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    })()`)
    console.log('SAMPLES ' + JSON.stringify(samples))
    console.log('UNIQUE ' + new Set(samples).size)
  } catch (e) {
    console.log('FAIL ' + String(e))
  } finally {
    await sleep(300)
    app.quit()
  }
})
