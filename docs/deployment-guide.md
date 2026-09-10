# Đóng gói bản cài

## Chạy

```bash
npm run build:mac      # → dist/ai-video-studio-0.1.0.dmg
npm run smoke:packaged # kiểm bản vừa đóng gói CHẠY được
```

**Bắt buộc Node 22.12 trở lên.** `electron-builder` 26.15.3 gọi `@noble/hashes`
bằng `require()`, mà gói đó chỉ còn ESM — Node 20 không `require()` được ESM nên
build ngã ngay ở bước dựng blockmap. 26.15.3 đã là bản mới nhất nên không có bản
vá để nâng lên; đổi Node là cách duy nhất.

```bash
nvm use 22 && npm run build:mac
```

## `ENOTEMPTY: rmdir dist/mac-arm64`

Mở thư mục đóng gói bằng Finder là nó để lại `.DS_Store` trong đó, và
electron-builder không xoá được thư mục cũ nên ngã ngay sau bước tải Electron.
Dọn tay rồi build lại:

```bash
rm -rf dist/mac-arm64 dist/mac-arm64.tmp
```

Xoá cả `dist/` cũng được, nhưng làm vậy là mất luôn bản `.dmg` trước đó nếu lần
build này hỏng.

## Build xong KHÔNG có nghĩa là chạy được

Ba lỗi dưới đây đều để build thành công rồi mới chết lúc chạy. Không có bước chạy
thử thì cả ba đi thẳng tới tay người dùng.

| Triệu chứng                                                                    | Nguyên nhân                                                                                                                                       | Cách xử lý                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| App tắt ngay khi mở, `Cannot find module 'react'`                              | Tiến trình main nạp tĩnh `@remotion/bundler`; chuỗi phụ thuộc của nó kéo tới `react`, thứ chỉ là devDependency nên không có trong gói             | Nạp bộ đóng gói bằng import động, chỉ ở nhánh dev              |
| Xuất video chết, `Hardware encoder "h264_videotoolbox" is not available`       | Phần dò năng lực hỏi ffmpeg ĐI KÈM, còn Remotion dựng bằng FFmpeg RIÊNG của nó. Trên macOS bản đi kèm có videotoolbox, bản của Remotion thì không | `hardwareAcceleration: 'if-possible'`, không dùng `'required'` |
| Xuất video chết, `ENOTDIR: chmod .../app.asar/@remotion/compositor-.../ffmpeg` | Remotion tự `chmod` file nhị phân theo đường dẫn nó phân giải, và đường đó trỏ vào asar — một kho ảo, không phải thư mục thật                     | `asar: false`                                                  |
| Xuất video chết, `mkdir '/.remotion'`                                          | Thiếu Chrome Headless Shell nên Remotion đi tải, và chỗ tải nó suy ra bằng cách trèo ngược từ thư mục làm việc. Mở từ Finder thì thư mục đó là `/`                | Đóng gói sẵn Chrome, truyền `browserExecutable`                |

`npm run smoke:packaged` bắt cả bốn: nó mở chính bản đã đóng gói, nhập media (đường
ffmpeg/ffprobe), rồi xuất một clip có chuyển động (đường Remotion).

Nó chạy app với thư mục làm việc `/`, không phải thư mục dự án. Chạy bằng cwd của
terminal là xanh giả: mọi đường dẫn tương đối đều rơi vào gốc dự án đang ghi được,
còn ở máy người dùng thì rơi vào `/` và ngã.

## Vì sao bundle Remotion dựng sẵn lúc build

`scripts/bundle-remotion.mjs` dựng `src/remotion/root.tsx` thành thư mục tĩnh và
electron-builder chép vào `Resources/remotion-bundle`.

Bản đóng gói không dựng lúc chạy được: `src/` bị loại khỏi gói theo cấu hình
`files`. Dựng sẵn còn bỏ luôn quãng chờ đóng gói ở lần xuất đầu tiên.

Khi thiếu thư mục đó, ứng dụng báo lỗi nói thẳng là bản build đóng gói sai, thay
vì để Remotion ngã với một lỗi mạng khó hiểu.

## Vì sao Chrome Headless Shell đóng gói sẵn

Remotion cần Chrome Headless Shell để dựng khung hình. Thiếu thì nó tự tải về một
thư mục cache mà nó suy ra bằng cách TRÈO NGƯỢC từ thư mục làm việc để tìm
`package.json`. Mở app từ Finder thì thư mục làm việc là `/`, không có
`package.json` nào ở trên, nên nó rơi về `/.remotion` — thư mục gốc chỉ đọc.

`scripts/bundle-chrome-headless-shell.mjs` để CHÍNH Remotion tải (`ensureBrowser`)
rồi chép vào `Resources/chrome-headless-shell`, kèm `binary-path.json` ghi đường
dẫn tương đối tới file nhị phân — lúc chạy khỏi phải đoán tên thư mục theo nền
tảng, đoán sai thì lỗi chỉ lộ ra ở lần xuất đầu tiên trên máy người dùng. Script
còn chạy thử `--version` để chép thiếu quyền thực thi thì hỏng ngay lúc build.

Không tự dựng URL tải: bản Chrome mà Remotion ghim nằm trong mã của nó, và bản
khác cho kết quả dựng khác.

Lúc chạy phải truyền `browserExecutable` cho CẢ `selectComposition` lẫn
`renderMedia`. Để trống một trong hai là bước đó lại đi tìm bản tải sẵn theo thư
mục làm việc.

## Không khai báo `publish`

Cấu hình scaffold để lại `https://example.com/auto-updates`. Khi nào thật sự làm
tự động cập nhật thì mới khai báo lại, kèm địa chỉ thật.

## Ký và công chứng

Bản build hiện ký bằng chứng chỉ Development có sẵn trong keychain, và
`notarize: false`. Đủ để chạy trên máy đã build.

**Máy khác sẽ bị Gatekeeper chặn.** Phát hành thật cần Developer ID Application và
bật công chứng — chưa làm.

## Kích thước

DMG 476 MB, thư mục ứng dụng 1,0 GB — đo TRƯỚC khi đóng gói kèm Chrome Headless
Shell; bản kèm Chrome cộng thêm khoảng 200 MB chưa nén, chưa đo lại DMG. Phần lớn
dung lượng là Remotion: Chrome Headless Shell, esbuild và rspack. Bỏ asar làm thư
mục cài phình thêm nhưng không đổi mấy dung lượng DMG vì nén bù lại.

## Chưa làm

- Build cho Windows và Linux chưa chạy thử lần nào; cấu hình có sẵn nhưng chưa
  ai xác minh.
- Chưa thay ffmpeg bằng bản build hợp lệ về giấy phép để phát hành.
- Chưa công chứng cho macOS.
