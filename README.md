# AI Video Studio

Trình chỉnh sửa video desktop chạy local, timeline nhiều track, giao diện tiếng Việt (có tiếng Anh),
được thiết kế để các công cụ AI — phiên âm, dịch, lồng tiếng, phụ đề — sinh ra **dữ liệu thật trên
timeline** thay vì một video đã đóng băng.

> **Trạng thái: Mốc 1 và Mốc 2 đã hoàn tất.**
> Nhập media, dựng timeline, xem trước, lưu/mở lại và xuất MP4 đều chạy thật.
> Giọng đọc đã **gọi ElevenLabs thật thành công**: sinh audio tiếng Việt, đo thời lượng bằng
> ffprobe, đưa vào timeline. Xem [Phạm vi hiện tại](#phạm-vi-hiện-tại).

---

## Yêu cầu hệ thống

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | ≥ 22 (đã kiểm thử trên 24.20) | `nvm use` sẽ đọc `.nvmrc` |
| npm | ≥ 10 | npm 11 chặn install script theo mặc định, xem bên dưới |
| Hệ điều hành | macOS (đã kiểm thử trên Apple Silicon) | Windows/Linux chưa được kiểm chứng |

**Không cần cài ffmpeg.** Ứng dụng dùng bản ffmpeg/ffprobe đi kèm qua npm. Đây là lựa chọn có chủ đích:
bản ffmpeg cài bằng Homebrew trên macOS thường được build **thiếu libass**, tức là không có filter
`subtitles`, và việc nung phụ đề sẽ hỏng một cách âm thầm.

## Cài đặt và chạy

```bash
nvm use                 # Node 22+
npm install
npm run dev             # mở ứng dụng ở chế độ phát triển
```

Nếu npm báo `packages have install scripts not yet covered by allowScripts`, chạy lệnh sau rồi cài lại —
Electron và ffmpeg cần install script để tải file nhị phân:

```bash
npm install-scripts approve electron ffmpeg-static @ffprobe-installer/darwin-arm64 esbuild
npm install
```

### Các lệnh khác

```bash
npm run build        # kiểm tra kiểu + đóng gói vào out/
npm start            # chạy bản đã build
npm test             # unit + integration (chạy ffmpeg thật)
npm run test:e2e     # build rồi chạy kiểm thử đầu-cuối trên Electron thật
npm run typecheck
npm run lint
```

## Dữ liệu được lưu ở đâu

```
<userData>/projects/<project-id>/
├── project.json     tài liệu project (có schemaVersion để migrate)
├── media/           media do ứng dụng quản lý
├── cache/           thumbnail, filmstrip, waveform — xoá được, sẽ tạo lại
└── versions/        bản chụp autosave
```

`<userData>` trên macOS là `~/Library/Application Support/ai-video-studio`.
Đặt biến `AVS_USER_DATA_DIR` để dùng thư mục khác (kiểm thử đầu-cuối dùng cơ chế này để chạy trên hồ sơ trống).

**File nguồn không bao giờ bị sao chép hay sửa đổi.** Project chỉ giữ tham chiếu tới đường dẫn gốc,
nên mọi thao tác chỉnh sửa đều không phá huỷ dữ liệu gốc.

## Phím tắt

| Phím | Tác dụng |
|---|---|
| `Space` | Phát / tạm dừng |
| `←` `→` | Lùi/tiến một frame (giữ `Shift` để nhảy 10 frame) |
| `S` | Cắt clip đang chọn tại playhead |
| `Delete` | Xoá clip đang chọn |
| `Cmd/Ctrl+Z` | Hoàn tác (thêm `Shift` để làm lại) |
| `Cmd/Ctrl+D` | Nhân bản clip |
| `+` `-` | Phóng to / thu nhỏ timeline |
| `Home` | Về đầu timeline |
| `Esc` | Bỏ chọn |

Phím tắt **không** kích hoạt khi con trỏ đang ở trong ô nhập liệu.

---

## Phạm vi hiện tại

### Đã chạy và đã kiểm chứng

- **Dự án**: tạo, mở, xoá, autosave, mở lại đúng trạng thái, bản chụp phiên bản, schema có version
- **Media**: nhập video/âm thanh/hình ảnh, đọc metadata bằng ffprobe, sinh thumbnail + filmstrip +
  waveform thật, chống nhập trùng bằng hash nội dung, phát hiện media bị thiếu
- **Timeline**: nhiều track video/âm thanh, kéo thả từ thư viện, di chuyển, cắt mép, tách, nhân bản,
  xoá, bắt dính (mép clip + playhead + lưới frame), zoom, ẩn/tắt tiếng/solo/khoá track
- **Xem trước**: phát, tạm dừng, tua, đi từng frame, xếp lớp nhiều clip, trộn tiếng nhiều track,
  timecode, đồng bộ bằng một đồng hồ chủ duy nhất
- **Hoàn tác/làm lại**: dựa trên patch, một nhóm lệnh chỉ tạo một bước hoàn tác
- **Xuất**: MP4 (H.264 + AAC), chọn độ phân giải và fps, tăng tốc phần cứng khi máy hỗ trợ,
  tiến trình thật từ ffmpeg, huỷ giữa chừng, nung phụ đề, xuất SRT riêng
- **Ngôn ngữ**: tiếng Việt mặc định, chuyển sang tiếng Anh ngay lập tức
- **Cấu hình AI**: khoá API lưu bằng `safeStorage` (macOS Keychain), kiểm tra kết nối,
  xoá khoá; thiếu khoá chỉ vô hiệu hoá đúng tính năng phụ thuộc
- **Giọng đọc**: chọn provider/model/giọng, danh sách giọng lấy từ provider, chia kịch bản
  thành đoạn tạo lại được riêng, chèn tại playhead / track mới / thay clip đang chọn
- **Nhạc nền**: tải nhạc, chèn vào track nhạc, chỉnh âm lượng và fade — **không cần khoá AI nào**
- **Tác vụ nền**: hàng đợi có trạng thái đầy đủ, huỷ thật, tái dùng kết quả cũ khi thử lại

### Chưa triển khai

Các tab này **có mặt trong giao diện và nói rõ là chưa có** — không tab nào giả vờ hoạt động:

- Phiên âm (Mốc 3)
- Dịch và lồng tiếng theo bản dịch (Mốc 3)
- Phụ đề: mô hình dữ liệu, ghi ASS/SRT và nung vào video **đã xong và đã kiểm thử**, nhưng
  **chưa có giao diện tạo/sửa phụ đề** (Mốc 3)
- AI Chat (Mốc 4)
- Auto-ducking (Mốc 4)
- Tạo nhạc bằng mô tả — chưa có nhà cung cấp nào có API công khai ổn định

### Đã kiểm chứng bằng API thật (ElevenLabs)

Chạy với khoá thật đã xác nhận: đọc model, liệt kê giọng, **sinh audio tiếng Việt** (110 ký tự →
7,20 giây, mp3 44,1 kHz), ffprobe đọc được file. Việc chạy thật này sửa **năm** chỗ sai mà kiểm thử
bằng fixture không thể phát hiện:

| Sai ở đâu | Bảng viết tay theo tài liệu | Sự thật từ API |
|---|---|---|
| Model cho tiếng Việt | `eleven_multilingual_v2` | Model đó **không** có `vi`; phải dùng `flash_v2_5`, `turbo_v2_5` hoặc `v3` |
| Giới hạn `eleven_v3` | 3.000 ký tự | 5.000 |
| `style` / `speaker_boost` | bật cho mọi model | có cờ `can_use_style` / `can_use_speaker_boost` **theo từng model** |
| Mã ngôn ngữ của giọng | dùng nguyên | **trùng lặp** (một giọng có `en` chín lần) — phải khử trùng |
| Thiếu quyền khoá | gộp vào "khoá sai" | 401 kèm `missing_permissions` là ca **khác hẳn**: khoá đúng, chỉ thiếu quyền |

Vì vậy siêu dữ liệu model giờ **đọc từ `/v1/models`**, không viết cứng trong mã.

### Giới hạn đã biết

- **OpenAI TTS chưa gọi thật lần nào.** Adapter viết theo tài liệu và kiểm thử bằng fixture; chưa
  có khoá OpenAI để xác nhận.
- **Giọng "thư viện" cần gói trả phí.** Tài khoản gói miễn phí bị từ chối bằng HTTP 402 khi dùng
  giọng `professional`. Giao diện đánh dấu phân loại giọng và cảnh báo trước.
- **Lọc giọng theo ngôn ngữ chỉ là gợi ý.** Nó lọc theo "ngôn ngữ đã xác thực" của giọng, nhưng
  model đa ngôn ngữ vẫn đọc được ngôn ngữ khác — giao diện nói rõ điều này.
- Tham số `speed` của ElevenLabs **không được đưa ra giao diện** vì khoảng giá trị hợp lệ chưa xác
  minh được. Việc co giãn thời lượng cho lồng tiếng sẽ dùng `atempo` của ffmpeg, không phụ thuộc provider.
- **Chỉ kiểm thử trên macOS Apple Silicon.** Windows/Linux chưa chạy thử lần nào.
- **Chưa đóng gói cài đặt.** `electron-builder` đã có cấu hình nhưng chưa dựng bản cài.
  Bản ffmpeg đi kèm hiện tại được build với `--enable-nonfree`, **không phát hành lại được** —
  trước khi phát hành phải thay bằng bản build hợp lệ về giấy phép.
- **Tốc độ clip** lưu được và export xử lý đúng, nhưng bản xem trước chưa co giãn cao độ âm thanh.
- Clip audio hiện chèn vào track âm thanh trống đầu tiên khi nhấn đúp; kéo thả cho phép chọn track chính xác.

---

## Kiến trúc

```
src/
├── shared/        dùng chung cho cả hai tiến trình — không phụ thuộc Electron
│   ├── domain/    schema project, quy ước thời gian, bộ giải composition
│   ├── commands/  tập lệnh chỉnh sửa, reducer thuần, lịch sử undo theo patch
│   ├── ai/        khai báo năng lực provider, interface theo nhóm tác vụ
│   ├── jobs/      vòng đời tác vụ nền
│   └── ipc/       hợp đồng giữa renderer và main
├── main/          tiến trình Node: đĩa, tiến trình con, ffmpeg, khoá API
│   ├── media/     probe, hash, waveform, thumbnail, scheme media
│   ├── storage/   ghi project nguyên tử, bố cục thư mục
│   ├── export/    dựng filter graph, chạy job, ghi ASS/SRT
│   ├── ai/        adapter provider, lớp HTTP phân loại lỗi, sổ đăng ký
│   ├── jobs/      hàng đợi, cache kết quả theo vân tay yêu cầu
│   ├── secrets/   lưu khoá bằng safeStorage
│   └── ipc/       các handler
├── preload/       cầu nối contextBridge (CommonJS, chạy trong sandbox)
└── renderer/      giao diện React
```

Bốn quyết định định hình phần còn lại:

1. **Thời gian là số nguyên microgiây, vị trí luôn tuyệt đối.** Không cộng dồn nên sai số làm tròn
   không bao giờ tích luỹ. Quy đổi sang frame chỉ xảy ra ở hai chỗ: lúc bắt dính và lúc export.

2. **Mọi thay đổi đi qua một tập lệnh có kiểm tra dữ liệu.** Thao tác tay và thao tác AI dùng chung
   đúng một đường ghi. AI sẽ không được phép ghi JSON thẳng vào project — nó chỉ phát ra command,
   và command phải qua schema. Cơ chế giao dịch gộp một nhóm thay đổi thành một bước hoàn tác.

3. **Xem trước và xuất đọc CÙNG một bộ giải composition** (`shared/domain/composition-resolver.ts`).
   Không có hai nguồn sự thật về timeline, nên bản xem trước không thể lệch khỏi bản xuất ra.

4. **Renderer không chạm vào đĩa hay tiến trình con.** Nó chạy trong sandbox và chỉ nói chuyện qua
   preload. Khoá API nằm hoàn toàn phía main: renderer chỉ hỏi được "provider này đã có khoá chưa",
   không có đường nào lấy lại giá trị khoá.

5. **Giao diện tham số AI được dựng từ khai báo năng lực của provider**, không viết cứng. Model nào
   không nhận một tham số thì ô đó KHÔNG tồn tại, chứ không phải bị làm mờ.

Xem [`docs/system-architecture.md`](docs/system-architecture.md) để biết chi tiết.

## Kiểm thử

| Loại | Số lượng | Nội dung |
|---|---|---|
| Unit | 46 | Quy đổi thời gian, biến đổi timeline, giao dịch lệnh, kiểm tra payload, vòng đời job, chia đoạn kịch bản |
| Integration | 24 | **Chạy ffmpeg thật**: probe, waveform, thumbnail, dựng lệnh xuất, render MP4, nung phụ đề, huỷ job |
| Adapter (fixture) | 18 | Máy chủ giả trả phản hồi đúng hình dạng thật: dựng đúng đường dẫn/header/body, đọc phân trang, tham số theo model, phân loại lỗi |
| Provider thật | 7 | **Gọi ElevenLabs thật.** Chỉ chạy khi có `ELEVENLABS_API_KEY`; không có thì tự bỏ qua |
| Đầu-cuối | 20 | **Chạy Electron thật đã build**: nhập media, dựng timeline, cắt, hoàn tác, đổi ngôn ngữ, lưu/mở lại, xuất MP4 rồi soi bằng ffprobe, lưu khoá qua keychain thật, tham số đổi theo model, nhạc nền chạy khi không có khoá |

```bash
npm test          # 88 phép thử (7 phép thử gọi API thật tự bỏ qua khi thiếu khoá)
npm run test:e2e  # 20 phép thử

# Kiểm chứng với provider thật — khoá KHÔNG bao giờ ghi vào repo:
ELEVENLABS_API_KEY=... npx vitest run src/main/ai/elevenlabs-live
```

Kiểm thử cố tình **không giả lập ffmpeg**: giá trị nằm ở chỗ tham số dòng lệnh có đúng không, mà đó
lại chính là phần một bản giả lập sẽ che mất.

## Giấy phép và ghi nhận

Dự án này được viết mới. `DESCRIPTION.md` có tham chiếu tới
[OpenChatCut](https://github.com/0xsline/OpenChatCut) (AGPL-3.0-or-later); repo đó chỉ được **đọc để
tham khảo kiến trúc**, **không có dòng mã nào được sao chép**, nên dự án này không phải là tác phẩm
phái sinh của nó.
