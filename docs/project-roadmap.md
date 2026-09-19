# Lộ trình

Mốc được chia theo `DESCRIPTION.md` §9. Mỗi mốc phải **chạy được và kiểm tra được** trước khi sang mốc sau.

## Mốc 1 — Nền tảng chạy được ✅ HOÀN TẤT

| Hạng mục | Trạng thái | Kiểm chứng bằng |
|---|---|---|
| Bố cục AI Studio / Preview / Inspector–Chat / Timeline | ✅ | e2e: bốn vùng đều hiện |
| Panel kéo giãn và thu gọn | ✅ | `react-resizable-panels`, kiểm tra bằng mắt ở 1440×900 |
| Nhập media (video/âm thanh/ảnh) | ✅ | e2e: thời lượng khớp ffprobe, thumbnail nạp được |
| Thumbnail, filmstrip, waveform | ✅ | integration: chạy ffmpeg thật, kiểm tra kích thước file |
| Timeline: kéo thả, di chuyển, cắt mép, tách, xoá, nhân bản | ✅ | unit + e2e |
| Bắt dính, zoom, playhead, thước thời gian | ✅ | unit (hình học) |
| Xem trước đồng bộ hình + tiếng | ✅ | kiểm tra bằng mắt, ảnh chụp màn hình |
| Hoàn tác/làm lại, gộp nhóm thành một bước | ✅ | unit + e2e |
| Lưu / mở lại, autosave, bản chụp phiên bản | ✅ | e2e: đóng dự án rồi mở lại, dữ liệu còn nguyên |
| Xuất MP4 | ✅ | e2e: soi lại file bằng ffprobe |
| Giao diện tiếng Việt + tiếng Anh | ✅ | e2e: đổi ngôn ngữ |

## Mốc 2 — Giọng đọc và nhạc nền ✅ HOÀN TẤT

| Hạng mục | Trạng thái | Kiểm chứng bằng |
|---|---|---|
| Cấu hình AI: provider, khoá qua `safeStorage`, kiểm tra kết nối | ✅ | e2e trên keychain thật |
| Interface riêng cho từng nhóm tác vụ (TTS/STT/dịch/nhạc) | ✅ | `shared/ai/ai-provider-contracts.ts` |
| Adapter ElevenLabs (danh sách giọng từ provider) | ✅ | **7 phép thử gọi API thật** + **7 phép thử đầu-cuối trọn luồng qua giao diện** |
| Adapter OpenAI (danh mục giọng cố định) | ⚠️ | fixture — chưa có khoá OpenAI để gọi thật |
| Chỉ hiện tham số provider thật sự hỗ trợ | ✅ | e2e: đổi model thì ô tham số biến mất |
| Chia kịch bản thành đoạn tạo lại riêng | ✅ | 9 unit + e2e |
| Chèn tại playhead / track mới / thay clip đang chọn | ✅ | `use-audio-insertion.ts` |
| Upload nhạc, chèn vào track riêng, chỉnh âm lượng/fade | ✅ | e2e, chạy khi không có khoá nào |
| Vòng đời job đầy đủ, huỷ thật, chống chèn trùng khi retry | ✅ | 10 unit |
| Thiếu khoá chỉ vô hiệu hoá tính năng phụ thuộc | ✅ | e2e |
| Khoá sai báo lỗi rõ ràng | ✅ | e2e (chạm mạng thật, nhận 401) |
| Provider TTS tự host (OmniVoice, Piper, XTTS…) | ✅ | 16 unit + 5 e2e trên máy chủ HTTP thật |
| Adapter Microsoft Edge TTS, không cần khoá | ✅ | 18 unit + **6 phép thử gọi thật**; 2 giọng tiếng Việt |
| Ước lượng độ dài đọc trước khi sinh, cảnh báo câu quá dài | ✅ | 12 unit + 7 e2e |

**Đã trả xong nợ Mốc 2.** Trọn luồng chạy thật qua giao diện với khoá ElevenLabs, sửa bảy chỗ sai mà
fixture không phát hiện được (xem README, mục "Đã kiểm chứng bằng API thật"), trong đó có hai lỗi
giao diện chỉ lộ ra khi chuyển tab với dữ liệu thật.

**Còn lại của Mốc 2:**

- OpenAI TTS vẫn chưa gọi thật lần nào — cần một khoá OpenAI.
- Edge TTS có trả mốc thời gian theo TỪNG TỪ nhưng chưa dùng: hợp đồng `TtsResult`
  chưa có chỗ nhận. Dùng được thì phụ đề khớp giọng đọc mà không cần chạy whisper.

## Mốc 3 — Phiên âm, dịch, phụ đề

- [x] Phiên âm có timestamp, chọn clip hoặc khoảng thời gian, tự nhận diện ngôn ngữ
      — chạy local bằng whisper.cpp, kiểm chứng bằng giọng nói thật
- [x] Trình soạn transcript, nhấn vào đoạn để tua preview tới đúng vị trí
- [ ] Phân biệt người nói khi provider hỗ trợ — whisper.cpp chỉ tách được theo
      kênh audio, chưa làm; chờ provider có diarization thật
- [x] Dịch giữ liên kết theo từng segment, hiển thị song song, sửa được từng đoạn, có glossary
      — qua máy chủ LLM kiểu OpenAI (Ollama, LM Studio, llama.cpp, OpenAI).
      **Chưa kiểm chứng với mô hình thật**: mới kiểm bằng máy chủ HTTP dựng sẵn.
      Chạy `LLM_BASE_URL=… LLM_MODEL=… npx vitest run src/main/ai/openai-compatible-translate-live`
      để kiểm với mô hình thật.
- [x] Giao diện tạo và sửa phụ đề (mô hình dữ liệu, ghi ASS/SRT, nung vào video)
- [x] Phụ đề song ngữ và các preset dễ đọc
- [x] Lồng tiếng theo bản dịch: tạo từng segment, **đo thời lượng thật**, phát hiện tràn giờ
- [x] Khi tràn giờ: cho chọn tăng tốc trong giới hạn / rút ngắn nội dung / kéo dài trên timeline.
      **Không bao giờ tự cắt mất lời nói.** — kiểm chứng bằng e2e đọc thẳng project.json

**Còn lại của Mốc 3:**

- Phân biệt người nói: whisper.cpp không làm được, chờ provider khác.
- Chất lượng dịch của một mô hình THẬT chưa được kiểm chứng — chưa có máy chủ LLM
  nào để gọi. Adapter mới chỉ được kiểm bằng máy chủ HTTP dựng sẵn tái hiện các
  kiểu trả lời sai.

## Mốc 4 — AI Chat và hoàn thiện

- [x] AI Chat dùng chung cấu hình với AI Studio (cùng provider máy chủ LLM với tab Dịch)
- [x] Chat đọc được project, clip đang chọn, playhead
- [x] Tool chỉnh sửa có kiểm tra dữ liệu, ánh xạ sang tập lệnh sẵn có
- [x] Thay đổi nhiều bước tạo bản đề xuất xem trước được rồi mới áp dụng
- [x] Phát hiện project đã đổi trong lúc AI chạy (so `revision` trước khi ghi)
- [x] Lịch sử hội thoại lưu theo project (`chat.json` cạnh project.json)
- [x] Auto-ducking: giảm nhạc nền tại đoạn có lời nói — cắt nhạc tại ranh giới lời
      nói rồi hạ âm lượng mảnh ở giữa. Chuyển mức là bậc thang, chưa có automation.
- [x] Tạo nhạc bằng mô tả — ElevenLabs Music (`POST /v1/music`), dùng chung khoá với
      phần giọng đọc. Hình dạng API đọc từ tài liệu chính thức, không theo trí nhớ.
      **Chưa gọi thật lần nào**: chưa có khoá ElevenLabs còn hiệu lực; mới kiểm
      bằng máy chủ HTTP dựng tại chỗ nói đúng giao thức.

**Còn lại của Mốc 4:**

- Đường gọi ElevenLabs Music chưa xác nhận bằng khoá thật.
- Auto-ducking chuyển mức theo bậc thang; muốn dốc mượt phải thêm automation âm
  lượng vào mô hình clip, không phải mẹo với fade.

## Mốc 5 — Agent bên ngoài dựng phim (MCP)

- [x] Máy chủ MCP Streamable HTTP trên loopback, có khoá truy cập
- [x] Công cụ ghi sinh từ CÙNG danh mục với AI Chat, qua cùng planner
- [x] Công cụ đọc: tổng quan dự án, transcript đầy đủ, thư viện media kèm đường dẫn ảnh
- [x] `build_cut_from_transcript` — dựng bản cut từ đoạn lời được giữ
- [x] `timeline/ripple-delete` — cắt bỏ khoảng và dồn phần sau lên
- [x] Giao diện công bố địa chỉ + khoá + đoạn cấu hình cho Claude Code
- [x] Đo tốc độ render Remotion trước khi quyết (`docs/remotion-render-benchmark.md`)
- [x] Lớp render Remotion: một composition dùng chung cho preview và xuất file
- [x] Preview chạy bằng `@remotion/player`
- [x] Chuyển cảnh: mờ chồng, trượt, gạt ngang, phóng vào — không làm co timeline
- [x] Chữ overlay như một đối tượng riêng, có hiệu ứng vào, AI tạo được
- ~~Phụ đề nảy chữ theo từng từ~~ — **không làm**, người dùng không cần
- [x] Phát hiện cú máy trong footage thô + trích ảnh đại diện, để agent chọn cảnh
      bằng HÌNH — đường duy nhất dựng được video không có tiếng
- [x] Chia lát cú máy quá dài — footage review quay điện thoại thường là MỘT cú
      máy liên tục, ffmpeg không tìm được mốc nào và agent nhận đúng một ảnh cho
      cả video. Lát chia đều được đánh dấu rõ là không phải chỗ chuyển cảnh.
- [x] `set_canvas` — không có nó thì footage dọc nằm trong khung 16:9 và không
      công cụ nào khác sửa được
- [x] `set_cut_transition` — agent đặt chuyển cảnh vào chỗ nối giữa hai clip, cùng
      mô hình với timeline (thay cho `set_clip_transition` đặt trên từng clip)
- [x] Nền hộp cho chữ overlay, chỉnh được cả trên giao diện lẫn qua công cụ
- [x] Chạy thử trọn luồng trên footage thật: 98 giây một cú máy → video dọc 25,9
      giây có chuyển cảnh, chữ và giọng đọc
- [x] Chuyển động trong clip: đẩy vào/ra chậm, lia bốn hướng, giật phóng, rung —
      thứ nâng cảm giác có hậu kỳ rõ nhất trên footage gần như tĩnh
- [x] Thêm sáu kiểu chuyển cảnh: lia vụt hai hướng, nhoè, nhiễu hình, xoay, loé
- [x] Chỉnh màu clip: sáng, tương phản, bão hoà, nhiệt độ, tối góc.
- [x] Tab Effects trong Library: 30 effect hình CHỒNG được trên một clip (phong
      cách, biến dạng, làm mờ, mặt nạ, tách nền, chỉnh màu), vẽ bằng bộ lọc SVG
      dùng chung cho preview, bản xuất và thẻ minh hoạ; chỉnh ở Inspector; agent
      dùng `add_clip_effect` / `update_clip_effect` / `remove_clip_effect` / `move_clip_effect`
      **Chưa nhận file `.cube`** — look màu dựng sẵn thì có (tab Filters, 16 look),
      nhưng bảng tra ba chiều từ file thì bộ lọc SVG không áp được; làm đúng phải
      đẩy từng khung qua shader, tức thêm một đường vẽ và một cái giá về tốc độ
      render chưa đo.
- [x] Công cụ agent/MCP theo tên tab mới: `set_clip_filter` (Filters), `set_clip_adjust`
      (Adjust), `set_clip_zoom` (Zoom); thêm `ripple_trim_clip`, `slip_clip`,
      `rate_stretch_clip`. Tổng quan dự án in đoạn nguồn, tốc độ, fade, Adjust, filter, zoom
      của từng clip.
- [x] Phủ nốt MCP theo những gì giao diện sửa được: `set_text_style` (cỡ chữ, nền hộp,
      neo trên/giữa/dưới, lề, bóng, số ký tự mỗi dòng, mẫu phụ đề); `rename_subtitle_track`,
      `remove_subtitle_track`; sửa/gộp/xoá transcript; sửa đoạn dịch, glossary, xoá bản dịch;
      `set_track` thêm solo và vai trò; `update_text_overlay` dời lane và thời lượng hiệu ứng;
      `update_subtitle_cue` sửa dòng song ngữ. Riêng MCP: `get_translation`, `undo`, `redo`,
      và xuất video `start_export` / `get_export_status` / `cancel_export` (chạy nền, agent
      hỏi tiến độ; tự chọn Remotion khi dự án có chữ overlay/chuyển cảnh; không ghi đè
      file có sẵn nếu không nêu `overwrite`). Vẫn cố ý KHÔNG phơi các job tốn tiền (phiên
      âm, dịch, lồng tiếng, nhạc); AI Chat trong app vẫn không tự xuất.
- [x] Hiệu ứng ra và viền phát sáng cho chữ overlay
- [x] Khung nền dễ thương cho chữ overlay: năm kiểu, sáu bộ màu, ba điểm trang
      trí góc. Vẽ bằng SVG sinh ra trong mã chứ không gom file ảnh — không giấy
      phép nào phải kiểm, không blob nào vào git, và bề mặt đóng gói bằng không.
      Khung co theo chữ bằng `border-image` chín ô nên góc không méo.
- [x] Tốc độ phát clip: mô hình dữ liệu và cả hai đường dựng đã cài đặt từ trước
      nhưng không có ô nào bật được — nay có ô trên panel Thuộc tính và công cụ
      `set_clip_speed` cho agent. Đổi tốc độ giữ nguyên khoảng nguồn và đổi độ dài
      trên timeline, nên không bao giờ đòi nhiều phim hơn số đang có.
- [x] Agent nhập được media vào thư viện qua MCP (`import_media`) — trước đó nó
      xoá được media nhưng không thêm được, nên mọi phiên đều phải có người bấm
      "Nhập media" trước.
- [x] Agent đặt được ảnh lên timeline (`insert_image`), và sửa lỗi `insert_clip`
      không bao giờ đặt được ảnh — ảnh có thời lượng nguồn bằng 0 nên phép kiểm
      biên của video làm nó chết trước khi nhìn tới thời lượng đã nêu.
- [x] Chọn màu chữ và màu viền cho chữ overlay, trên giao diện lẫn qua
      `set_text_color` — trước đó màu chữ chỉ đổi được gián tiếp bằng cách chọn
      nền hộp hoặc khung.
- [x] Track ảnh riêng, thứ tự lớp theo lane, kéo/đổi cỡ/xoay clip ngay trên khung
      xem trước, và các chế độ công cụ timeline (trim, ripple trim, slip, rate
      stretch, blade)
- [x] Thư viện hiệu ứng âm thanh dựng sẵn, đóng gói theo app — không gọi API, không
      tốn phí, không phụ thuộc mạng. Thay cho kế hoạch gọi ElevenLabs Sound Effects
      ban đầu (`plans/260909-1525-elevenlabs-sound-effects/`), bỏ giữa chừng vì một
      thư viện offline phủ đúng nhu cầu mà không có chi phí nào
- [x] **Keyframe**: transform clip, âm lượng clip, thông số effect kiểu số,
      vị trí/cỡ/góc chữ overlay. Năm kiểu nội suy (đều, giữ nguyên, chậm
      đầu/cuối/hai đầu), nút kim cương ở panel Thuộc tính, dải chấm kéo được trên
      timeline, chép/dán cụm keyframe giữa các clip, và công cụ cho agent. Chi tiết quyết định thiết kế:
      `docs/system-architecture.md` §Keyframe
- [x] Chép/dán CLIP bằng Cmd+C / Cmd+V, giữ nguyên mọi thuộc tính
- [x] Nhập file phụ đề `.srt` / `.vtt` có sẵn — trước đó phụ đề chỉ đi ra được
- [x] Liên kết lại media bị thiếu, và đổi tỉ lệ khung / tốc độ khung sau khi tạo
      dự án — hai thứ backend đã xong từ lâu mà giao diện không có đường gọi
- [ ] Đổi mặc định xuất sang Remotion khi các tính năng trên đủ chín — hiện mặc
      định vẫn là ffmpeg, chỉ tự chuyển sang Remotion khi dự án có chuyển cảnh,
      chữ overlay, effect, chỉnh màu hoặc keyframe

## Backlog (chưa xếp lịch)

Theo `DESCRIPTION.md` §9: "Tính năng chưa có như tạo video AI, hiệu ứng nâng cao hoặc tracking được
ghi vào backlog rõ ràng."

- Sinh video bằng AI
- LUT (.cube) — cần một đường vẽ WebGL riêng; xem mục chỉnh màu ở Mốc 5
- Keyframe cho các nhóm CÒN LẠI: chỉnh màu, đệm khung chữ, `look.intensity`
  (phải xử `LookFilterDefs` trước — xem `docs/system-architecture.md` §Keyframe), và đường
  cong bezier tuỳ biến.
  **Đã xong:** transform clip, âm lượng clip, thông số effect kiểu số, vị trí/cỡ/góc chữ
  overlay, và sao chép/dán cụm keyframe giữa các clip
- Hiệu ứng cần WebGL (ASCII, kính vạn hoa, mắt cá, halftone) và HSL theo dải màu
  — bộ lọc SVG không dựng được
- Thao tác dựng phim còn thiếu, rà soát ngày 2026-09-19: nút ripple delete cho
  người dùng; marker/chapter; khoá clip lẻ; nhóm clip (`linkGroupId` có trường
  nhưng không có logic đọc); kéo và sửa nhiều clip cùng lúc; sóng âm trên clip
  video có tiếng; nút cho `build_cut_from_transcript` và `build_cut_from_shots`
- Xuất: thêm định dạng ngoài MP4/H.264, chọn chất lượng, preset nền tảng, xuất
  riêng đoạn đang chọn, hàng đợi nhiều bản
- Bám đối tượng và tự cắt khung theo chủ thể
- Đa camera
- Đóng gói bản cài cho **Windows và Linux** — cấu hình có sẵn nhưng chưa chạy thử
  lần nào. Bản macOS đã đóng gói và chạy thật được, xem `docs/deployment-guide.md`.
- Công chứng cho macOS (cần Developer ID); bản hiện tại ký bằng chứng chỉ
  Development nên máy khác sẽ bị Gatekeeper chặn
- Thay ffmpeg bằng bản build hợp lệ về giấy phép trước khi phát hành
- Kiểm chứng trên Windows và Linux
- Co giãn cao độ âm thanh khi đổi tốc độ clip trong bản xem trước
- Nhân bản giọng (voice cloning) cho máy chủ tự host — các dự án chưa thống nhất tên trường
- Chạy thử với omnivoice-server thật (cần PyTorch + model hàng GB)
- Ảo hoá timeline khi số clip rất lớn

## Câu hỏi còn mở

1. **Khoá OpenAI** để gọi thật adapter OpenAI TTS một lần. ElevenLabs đã xác nhận xong.
2. **Phiên âm chạy local hay trên cloud?** Whisper chạy local thì miễn phí và giữ dữ liệu trong máy,
   đổi lại nặng vài trăm MB model và chậm hơn. Ảnh hưởng tới kích thước bản cài.
3. **Ngưỡng tăng tốc khi lồng tiếng.** Hiện đặt mặc định 1.3×; con số này nên do người dùng chỉnh hay
   cố định?
