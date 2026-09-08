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

## Build xong KHÔNG có nghĩa là chạy được

Ba lỗi dưới đây đều để build thành công rồi mới chết lúc chạy. Không có bước chạy
thử thì cả ba đi thẳng tới tay người dùng.

| Triệu chứng                                                                    | Nguyên nhân                                                                                                                                       | Cách xử lý                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| App tắt ngay khi mở, `Cannot find module 'react'`                              | Tiến trình main nạp tĩnh `@remotion/bundler`; chuỗi phụ thuộc của nó kéo tới `react`, thứ chỉ là devDependency nên không có trong gói             | Nạp bộ đóng gói bằng import động, chỉ ở nhánh dev              |
| Xuất video chết, `Hardware encoder "h264_videotoolbox" is not available`       | Phần dò năng lực hỏi ffmpeg ĐI KÈM, còn Remotion dựng bằng FFmpeg RIÊNG của nó. Trên macOS bản đi kèm có videotoolbox, bản của Remotion thì không | `hardwareAcceleration: 'if-possible'`, không dùng `'required'` |
| Xuất video chết, `ENOTDIR: chmod .../app.asar/@remotion/compositor-.../ffmpeg` | Remotion tự `chmod` file nhị phân theo đường dẫn nó phân giải, và đường đó trỏ vào asar — một kho ảo, không phải thư mục thật                     | `asar: false`                                                  |

`npm run smoke:packaged` bắt cả ba: nó mở chính bản đã đóng gói, nhập media (đường
ffmpeg/ffprobe), rồi xuất một clip có chuyển động (đường Remotion).

## Vì sao bundle Remotion dựng sẵn lúc build

`scripts/bundle-remotion.mjs` dựng `src/remotion/root.tsx` thành thư mục tĩnh và
electron-builder chép vào `Resources/remotion-bundle`.

Bản đóng gói không dựng lúc chạy được: `src/` bị loại khỏi gói theo cấu hình
`files`. Dựng sẵn còn bỏ luôn quãng chờ đóng gói ở lần xuất đầu tiên.

Khi thiếu thư mục đó, ứng dụng báo lỗi nói thẳng là bản build đóng gói sai, thay
vì để Remotion ngã với một lỗi mạng khó hiểu.

## Không khai báo `publish`

Cấu hình scaffold để lại `https://example.com/auto-updates`. Khi nào thật sự làm
tự động cập nhật thì mới khai báo lại, kèm địa chỉ thật.

## Ký và công chứng

Bản build hiện ký bằng chứng chỉ Development có sẵn trong keychain, và
`notarize: false`. Đủ để chạy trên máy đã build.

**Máy khác sẽ bị Gatekeeper chặn.** Phát hành thật cần Developer ID Application và
bật công chứng — chưa làm.

## Kích thước

DMG 476 MB, thư mục ứng dụng 1,0 GB. Phần lớn là Remotion: nó kéo theo Chrome
Headless Shell, esbuild và rspack. Bỏ asar làm thư mục cài phình thêm nhưng không
đổi mấy dung lượng DMG vì nén bù lại.

## Chưa làm

- Build cho Windows và Linux chưa chạy thử lần nào; cấu hình có sẵn nhưng chưa
  ai xác minh.
- Chưa thay ffmpeg bằng bản build hợp lệ về giấy phép để phát hành.
- Chưa công chứng cho macOS.
