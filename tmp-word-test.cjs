const { app, BrowserWindow } = require('electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1320, height: 860, show: true, x: 40, y: 30 })
  const js = (code) => win.webContents.executeJavaScript(code)

  try {
    await win.loadURL('http://localhost:5174/#/search?q=Shape%20of%20You')
    await sleep(3400)
    await js("document.querySelector('.track-table .row').click()")
    await sleep(3500)
    await js("location.hash = '#/lyrics'")
    await sleep(2600)

    // 跳到一段有逐字的歌词上
    await js(`(() => { const l = [...document.querySelectorAll('.lyric-line')].find(n => n.textContent.includes('club')); if (l) l.click(); return !!l; })()`)
    await sleep(1200)

    // 采样 1 秒内的 word 填充比例，看更新频率
    const samples = await js(`(async () => {
      const out = [];
      for (let i = 0; i < 20; i += 1) {
        const w = document.querySelector('.lyric-line--active .lyric-line__word');
        out.push(w ? getComputedStyle(w).backgroundSize : 'none');
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    })()`)
    console.log('WORDS ' + JSON.stringify(await js("document.querySelectorAll('.lyric-line--active .lyric-line__word').length")))
    console.log('SAMPLES ' + JSON.stringify(samples))
    console.log('UNIQUE ' + new Set(samples).size)
  } catch (e) {
    console.log('FAIL ' + String(e))
  } finally {
    await sleep(300)
    app.quit()
  }
})
