# AI Video Studio

Trình chỉnh sửa video desktop chạy local, timeline nhiều track, giao diện tiếng Việt (có tiếng Anh),
được thiết kế để các công cụ AI — phiên âm, dịch, lồng tiếng, phụ đề — sinh ra **dữ liệu thật trên
timeline** thay vì một video đã đóng băng.

> **Trạng thái: Mốc 1 và Mốc 2 đã hoàn tất.**
> Nhập media, dựng timeline, xem trước, lưu/mở lại và xuất MP4 đều chạy thật.
> Giọng đọc đã **chạy trọn luồng với ElevenLabs thật**: nhập khoá vào Keychain, lấy model và giọng
> từ tài khoản, sinh audio tiếng Việt, đo thời lượng bằng ffprobe, thành clip cắt/hoàn tác được trên
> timeline. Xem [Phạm vi hiện tại](#phạm-vi-hiện-tại).

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

Tên thư mục này **cố ý khác** tên hiển thị của app ("AI Video Studio"). Mặc định
Electron lấy thư mục dữ liệu theo tên app, nên đổi tên hiển thị sẽ kéo thư mục
sang chỗ mới và mọi dự án đã lưu biến mất khỏi app — chúng vẫn nằm trên đĩa, chỉ
là app không nhìn vào đó nữa. Tên thư mục là chuyện của dữ liệu, tên hiển thị là
chuyện của giao diện; hai thứ đó được tách hẳn ra.
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
| `Shift+Delete` | Ripple delete: xoá clip và dồn clip sau trên cùng track lên |
| `M` | Đặt marker tại đầu phát |
| `Shift+M` / `Cmd+Shift+M` | Tới marker kế / về marker trước |
| `Cmd/Ctrl+Z` | Hoàn tác (thêm `Shift` để làm lại) |
| `Cmd/Ctrl+D` | Nhân bản clip |
| `Cmd/Ctrl+G` | Gộp các clip đang chọn thành nhóm (thêm `Shift` để rã nhóm) |
| `Shift`+bấm | Chọn thêm clip — kéo một clip là dời cả loạt đang chọn |
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
- **Keyframe**: cho một thuộc tính đổi giá trị theo thời gian thay vì một giá trị cho cả clip.
  Phủ transform clip (x, y, phóng, xoay, độ mờ), cường độ + thông số **kiểu số** của effect, và
  vị trí / cỡ chữ / góc xoay của chữ overlay. Đặt bằng nút kim cương trong panel Thuộc tính,
  kéo/xoá/đổi kiểu nội suy bằng dải chấm dưới clip, hoặc bằng câu lệnh cho agent. Năm kiểu nội
  suy: đều, giữ nguyên, chậm đầu, chậm cuối, chậm hai đầu. Keyframe đi theo clip khi cắt mép,
  tách đôi, đổi tốc độ, nhân bản — và **đi tới file xuất**, đã soi bằng pixel
- **Phiên âm**: whisper.cpp chạy local, có timestamp từng từ, trình soạn transcript nhấn để tua
- **Dịch**: giữ liên kết theo segment, sửa từng đoạn, có glossary, qua máy chủ LLM kiểu OpenAI
- **Phụ đề**: tạo từ transcript hoặc bản dịch, song ngữ, preset kiểu chữ, **nhập file `.srt`/`.vtt`
  có sẵn**, nung vào video và xuất SRT riêng
- **Lồng tiếng theo bản dịch**: đo thời lượng thật, phát hiện tràn giờ, ba lối thoát, không cắt lời
- **AI Chat và MCP**: agent đọc dự án và sửa qua cùng tập lệnh với giao diện; agent ngoài (Claude
  Code) nối vào qua máy chủ MCP trên loopback
- **Auto-ducking**: hạ nhạc nền ở đoạn có lời nói bằng keyframe âm lượng — dốc mượt, không cắt clip
- **Keyframe**: transform clip, âm lượng clip, thông số effect kiểu số, vị trí/cỡ/góc chữ
  overlay; năm kiểu nội suy; chép/dán cụm keyframe giữa các clip
- **Chép/dán clip** bằng Cmd+C / Cmd+V, giữ nguyên mọi thuộc tính
- **Cắt khoảng lặng**: dò chỗ im trong tiếng của clip đang chọn bằng ffmpeg `silencedetect`
  (không cần phiên âm), báo trước sẽ cắt bao nhiêu giây, chừa lại hơi cạnh lời nói; chọn chỉ co
  track của clip (nhạc nền đứng yên) hoặc cả video (phụ đề, chữ, marker trôi theo)
- **Khôi phục phiên bản**: nút Phiên bản trên thanh trên cùng liệt kê bản chụp tự động (mỗi 5 phút)
  và bản lưu tay; khôi phục luôn chụp lại bản hiện tại trước nên khôi phục nhầm vẫn quay lại được
- **Ripple delete** clip (nút + `Shift+Delete`): xoá rồi dồn clip sau **trên cùng track** lên —
  track khác đứng yên, cùng luật với ripple trim
- **Marker**: đặt bằng `M`, kéo để dời, nháy đúp để đặt tên/màu/xoá, nhảy qua lại bằng
  `Shift+M`; **chép danh sách chương** dạng YouTube vào clipboard. Agent dùng `add_marker` /
  `update_marker` / `remove_marker` / `ripple_delete_clip`
- **Kéo nhiều clip cùng lúc** (kể cả trên nhiều track, giữ nguyên khoảng cách) và **nhóm clip**:
  bấm một clip là chọn cả nhóm, dời một clip là dời cả nhóm; cắt mép/tốc độ/effect vẫn tác động
  riêng từng clip. Agent dùng được qua `group_clips` / `ungroup_clips` / `move_clip`
- **Liên kết lại media bị thiếu**, và đổi tỉ lệ khung / tốc độ khung sau khi đã tạo dự án
- **Hoàn tác/làm lại**: dựa trên patch, một nhóm lệnh chỉ tạo một bước hoàn tác
- **Xuất**: MP4 (H.264 + AAC), chọn độ phân giải và fps, tăng tốc phần cứng khi máy hỗ trợ,
  tiến trình thật từ ffmpeg, huỷ giữa chừng, nung phụ đề, xuất SRT riêng
- **Ngôn ngữ**: tiếng Việt mặc định, chuyển sang tiếng Anh ngay lập tức
- **Cấu hình AI**: khoá API lưu bằng `safeStorage` (macOS Keychain), kiểm tra kết nối,
  xoá khoá; thiếu khoá chỉ vô hiệu hoá đúng tính năng phụ thuộc
- **Máy chủ TTS tự host**: chạy được với mọi máy chủ có `POST /v1/audio/speech` —
  omnivoice-server (bọc OmniVoice), Piper, Coqui XTTS, openedai-speech, Kokoro… Không cần khoá,
  không tốn phí gọi API, dữ liệu không rời máy
- **Giọng đọc**: chọn provider/model/giọng, danh sách giọng và model lấy **trực tiếp từ tài khoản**,
  chia kịch bản thành đoạn tạo lại được riêng, chèn tại playhead / track mới / thay clip đang chọn.
  Audio AI tạo ra là asset thật: có waveform, thời lượng đo bằng ffprobe, cắt và hoàn tác được
- **Nhạc nền**: tải nhạc, chèn vào track nhạc, chỉnh âm lượng và fade — **không cần khoá AI nào**
- **Tác vụ nền**: hàng đợi có trạng thái đầy đủ, huỷ thật, tái dùng kết quả cũ khi thử lại

### Chưa triển khai

Không tab nào trong giao diện là khung rỗng. Những thứ dưới đây chưa có, và lý do thì cụ thể:

- **Phân biệt người nói** — whisper.cpp không làm được; chờ provider có diarization thật
- **Nhận file LUT `.cube`** — bộ lọc SVG không áp được bảng tra ba chiều, làm đúng phải đẩy
  từng khung qua shader. Look màu dựng sẵn thì đã có (tab Filters, 16 look)
- **Effect cần WebGL**: ASCII, kính vạn hoa, mắt cá, halftone, HSL theo dải màu
- **Bám đối tượng, đa camera, sinh video bằng AI** — xem backlog trong `docs/project-roadmap.md`

### Đã kiểm chứng bằng API thật (ElevenLabs)

Trọn luồng chạy qua giao diện thật, có 7 phép thử đầu-cuối gọi API thật: nhập khoá vào Keychain →
kiểm tra kết nối → lấy model và giọng từ tài khoản → **sinh audio tiếng Việt** → asset vào thư viện
với thời lượng đo bằng ffprobe → chèn thành clip → cắt → hoàn tác → tạo lại thì dùng lại kết quả cũ
mà không sinh asset trùng.

Việc chạy thật sửa **bảy** chỗ sai mà kiểm thử bằng fixture không thể phát hiện — vì fixture chỉ
khẳng định lại đúng những giả định đã sai từ đầu:

| Sai ở đâu | Bảng viết tay theo tài liệu | Sự thật từ API |
|---|---|---|
| Model cho tiếng Việt | `eleven_multilingual_v2` | Model đó **không** có `vi`; phải dùng `flash_v2_5`, `turbo_v2_5` hoặc `v3` |
| Giới hạn `eleven_v3` | 3.000 ký tự | 5.000 |
| `style` / `speaker_boost` | bật cho mọi model | có cờ `can_use_style` / `can_use_speaker_boost` **theo từng model** |
| Mã ngôn ngữ của giọng | dùng nguyên | **trùng lặp** (một giọng có `en` chín lần) — phải khử trùng |
| Thiếu quyền khoá | gộp vào "khoá sai" | 401 kèm `missing_permissions` là ca **khác hẳn**: khoá đúng, chỉ thiếu quyền |
| Lọc giọng theo ngôn ngữ | lọc cứng | 23 giọng chỉ 2 giọng xác thực tiếng Việt, và cả hai gói miễn phí **không dùng được** — lọc cứng giấu mất 21 giọng vẫn đọc tiếng Việt tốt. Giờ chỉ **đánh dấu + xếp trước** |
| Gói tài khoản | không xét | Giọng "thư viện" bị **HTTP 402** trên gói miễn phí; giao diện cảnh báo trước |

Vì vậy siêu dữ liệu model giờ **đọc từ `/v1/models`**, không viết cứng trong mã.

### Giới hạn đã biết

- **OpenAI TTS chưa gọi thật lần nào.** Adapter viết theo tài liệu và kiểm thử bằng fixture; chưa
  có khoá OpenAI để xác nhận.
- **omnivoice-server thật chưa chạy thử.** Chạy nó cần PyTorch và tải model hàng GB. Adapter được
  kiểm thử bằng máy chủ HTTP thật dựng trong test, nói đúng giao thức theo tài liệu của dự án đó —
  nhưng chưa xác nhận omnivoice-server hành xử đúng như tài liệu.
- **Nhân bản giọng chưa hỗ trợ.** Các máy chủ tự host dùng tên trường khác nhau (`ref_audio`,
  `speaker_id`, đường dẫn file) và chưa có chuẩn chung; adapter chỉ cam kết phần lõi mọi máy chủ
  đều có.
- **Giọng "thư viện" cần gói trả phí.** Tài khoản gói miễn phí bị từ chối bằng HTTP 402 khi dùng
  giọng `professional`. Giao diện đánh dấu phân loại giọng và cảnh báo trước.
- **Lọc giọng theo ngôn ngữ chỉ là gợi ý.** Nó lọc theo "ngôn ngữ đã xác thực" của giọng, nhưng
  model đa ngôn ngữ vẫn đọc được ngôn ngữ khác — giao diện nói rõ điều này.
- Tham số `speed` của ElevenLabs **không được đưa ra giao diện** vì khoảng giá trị hợp lệ chưa xác
  minh được. Việc co giãn thời lượng cho lồng tiếng sẽ dùng `atempo` của ffmpeg, không phụ thuộc provider.
- **Thiếu vài thao tác dựng phim thông dụng**, đã rà soát và ghi lại để khỏi tìm lại: ripple
  delete chỉ agent gọi được, giao diện chưa có nút; không có marker/chapter, không khoá được clip
  lẻ, không nhóm clip; chọn nhiều clip thì kéo và panel thuộc tính vẫn chỉ ăn clip đầu tiên; sóng
  âm không hiện trên clip video có tiếng.
- **Dựng cut theo lời nói và theo cú máy chỉ agent gọi được** (`build_cut_from_transcript`,
  `build_cut_from_shots`) — giao diện chưa có nút, dù phần dò cú máy đã chạy thật.
- **Xuất chỉ MP4/H.264, chất lượng cố định**, không preset, không xuất riêng đoạn đang chọn,
  không hàng đợi nhiều bản.
- **Chỉ kiểm thử trên macOS Apple Silicon.** Windows/Linux chưa chạy thử lần nào.
- **Bản cài macOS dựng được, nhưng chưa phát hành được.** `npm run build:mac` cho ra `.dmg`
  chạy thật trên máy đã dựng nó. Hai thứ chặn việc đưa cho người khác: bản chưa **công chứng**
  (`notarize: false`, cần Developer ID) nên Gatekeeper sẽ chặn ở máy khác; và bản ffmpeg đi
  kèm được build với `--enable-nonfree`, **không phát hành lại được** — phải thay bằng bản
  build hợp lệ về giấy phép trước đã. Windows/Linux có cấu hình nhưng chưa dựng thử lần nào.
- **Dự án có keyframe bắt buộc xuất bằng Remotion**, và hộp thoại Xuất tự khoá lựa chọn đó.
  Filter graph ffmpeg đọc transform dạng hằng số nên nó sẽ cho ra file đứng hình mà không báo
  gì. Remotion chậm hơn đáng kể — đó là cái giá của việc không rơi mất chuyển động.
- **Keyframe chưa phủ**: chỉnh màu, đệm khung chữ, cường độ filter (LUT). Thông
  số effect **kiểu màu và kiểu lựa chọn** cũng không animate được — "màu ở giữa hai màu" và
  "lựa chọn ở giữa hai lựa chọn" là hai bài toán khác hẳn, không phải quên.
- **Chưa có đường cong bezier tuỳ biến** cho keyframe (năm kiểu nội suy dựng sẵn thì có).
- **Tốc độ clip** lưu được và export xử lý đúng, nhưng bản xem trước chưa co giãn cao độ âm thanh.
- **Âm lượng trên 100% chỉ nghe được ở file xuất ra.** Thẻ media của trình duyệt chỉ nhận
  khoảng 0..1, nên bản xem trước không to hơn 100% được; giao diện nói rõ điều này ngay dưới
  thanh trượt. Muốn preview to hơn thì phải dựng đồ thị WebAudio cho lớp phát.
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
| Provider thật | 7 | **Gọi ElevenLabs thật** ở tầng adapter. Chỉ chạy khi có `ELEVENLABS_API_KEY` |
| Đầu-cuối provider thật | 7 | **Trọn luồng qua giao diện với API thật**: khoá → giọng → sinh audio → clip → cắt → hoàn tác |
| Máy chủ tự host | 21 | 16 unit + 5 đầu-cuối chạy trên **máy chủ HTTP thật** dựng trong test, trả audio WAV thật |
| Keyframe | 96 + 15 | 96 unit cho nội suy, biến đổi khi cắt/tách, đường vẽ, công cụ agent; 15 đầu-cuối cho nút kim cương và dải chấm trên timeline |
| Đầu-cuối | 28 spec | **Chạy Electron thật đã build**: nhập media, dựng timeline, cắt, hoàn tác, đổi ngôn ngữ, lưu/mở lại, xuất MP4 rồi soi bằng ffprobe, lưu khoá qua keychain thật, tham số đổi theo model, nhạc nền chạy khi không có khoá |

```bash
npm test          # 960 đạt + 21 bỏ qua (nhóm gọi API thật)
npm run test:e2e  # 228 đạt + 12 bỏ qua (nhóm gọi API thật)

# Chạy đầy đủ kể cả phần gọi provider thật — khoá KHÔNG bao giờ ghi vào repo:
ELEVENLABS_API_KEY=... npx vitest run
ELEVENLABS_API_KEY=... npx playwright test
```

Kiểm thử cố tình **không giả lập ffmpeg**: giá trị nằm ở chỗ tham số dòng lệnh có đúng không, mà đó
lại chính là phần một bản giả lập sẽ che mất.

## Dùng TTS tự host (OmniVoice và các máy chủ khác)

Ứng dụng nói giao thức `POST /v1/audio/speech` kiểu OpenAI — chuẩn de-facto của hệ sinh thái TTS tự
host. Vì vậy **một provider dùng chung cho tất cả**, không phải mỗi dự án một adapter.

### OmniVoice

[k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice) hỗ trợ 646 ngôn ngữ, trong đó **tiếng Việt có
8.481 giờ dữ liệu huấn luyện**. Repo chính thức không kèm máy chủ HTTP (chỉ có Gradio demo và SDK
Python), nên cần một lớp bọc:

```bash
pip install torch            # bản CPU hoặc CUDA tuỳ máy
pip install omnivoice-server
omnivoice-server             # lắng nghe ở http://localhost:8880
```

Rồi trong ứng dụng: **Cấu hình AI → Máy chủ tự host** → điền `http://localhost:8880/v1` → Lưu cấu
hình → Kiểm tra kết nối.

> ⚠️ **Giấy phép:** mã nguồn OmniVoice là Apache-2.0 nhưng **trọng số model là CC-BY-NC** — không
> dùng cho mục đích thương mại. Cân nhắc điều này trước khi đưa vào quy trình sản xuất.

### Máy chủ khác

Cùng một provider, chỉ đổi địa chỉ: [openedai-speech](https://github.com/matatonic/openedai-speech),
[Piper HTTP](https://github.com/Kamil-Krawiec/piper-tts-http-server),
[Coqui XTTS](https://github.com/teddybear082/WingmanAI-Coqui-TTS-Openai-Server), Kokoro FastAPI.

### Chọn giọng

Phần lớn máy chủ tự host **không có endpoint liệt kê giọng**. Ứng dụng thử dò `/v1/audio/voices`
trước; không có thì cho bạn **gõ thẳng tên giọng**, hoặc điền sẵn danh sách trong ô "Danh sách giọng"
ở Cấu hình AI. Ứng dụng cố tình không bịa ra một danh sách giọng có thể không tồn tại trên máy chủ
của bạn.

## Giấy phép và ghi nhận

Dự án này được viết mới. `DESCRIPTION.md` có tham chiếu tới
[OpenChatCut](https://github.com/0xsline/OpenChatCut) (AGPL-3.0-or-later); repo đó chỉ được **đọc để
tham khảo kiến trúc**, **không có dòng mã nào được sao chép**, nên dự án này không phải là tác phẩm
phái sinh của nó.
