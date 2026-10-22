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
    await js("(() => { const b = document.querySelector('.now__cover'); if (b) b.click(); return !!b; })()")
    await sleep(2500)

    // 等当前行有逐字（跳过开头的制作人信息行）
    await sleep(9000)

    const report = await js(`(async () => {
      const snapshots = [];
      for (let i = 0; i < 20; i += 1) {
        const words = [...document.querySelectorAll('.lyric-line--active .lyric-line__word')];
        snapshots.push(words.map((w) => getComputedStyle(w).backgroundSize.split(' ')[0]).join('|'));
        await new Promise((r) => setTimeout(r, 50));
      }
      const uniq = new Set(snapshots);
      return { line: document.querySelector('.lyric-line--active')?.textContent.trim().slice(0, 40), wordCount: snapshots[0]?.split('|').length ?? 0, frames: uniq.size, sample: [...uniq].slice(0, 6) };
    })()`)
    console.log('FILL ' + JSON.stringify(report))
  } catch (e) {
    console.log('FAIL ' + String(e))
  } finally {
    await sleep(300)
    app.quit()
  }
})
