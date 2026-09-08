// Vỏ Electron tối giản chỉ để đo preview trong ĐÚNG môi trường app sẽ chạy.
// Đo bằng Chromium rời của Playwright cũng được, nhưng Electron mới là thật.
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 700,
    height: 1100,
    show: true,
    webPreferences: { backgroundThrottling: false }
  })
  window.loadURL(process.env.BENCH_URL)
})

app.on('window-all-closed', () => app.quit())
