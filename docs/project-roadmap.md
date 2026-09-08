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

**Đã trả xong nợ Mốc 2.** Trọn luồng chạy thật qua giao diện với khoá ElevenLabs, sửa bảy chỗ sai mà
fixture không phát hiện được (xem README, mục "Đã kiểm chứng bằng API thật"), trong đó có hai lỗi
giao diện chỉ lộ ra khi chuyển tab với dữ liệu thật.

**Còn lại:** OpenAI TTS vẫn chưa gọi thật lần nào — cần một khoá OpenAI.

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
- [ ] Phát hiện chuyển cảnh trong footage thô
- [ ] Đổi mặc định xuất sang Remotion khi các tính năng trên đủ chín

## Backlog (chưa xếp lịch)

Theo `DESCRIPTION.md` §9: "Tính năng chưa có như tạo video AI, hiệu ứng nâng cao hoặc tracking được
ghi vào backlog rõ ràng."

- Sinh video bằng AI
- Hiệu ứng nâng cao, chuyển cảnh, keyframe, LUT
- Bám đối tượng và tự cắt khung theo chủ thể
- Đa camera
- Đóng gói bản cài cho macOS / Windows / Linux (cần thay ffmpeg bằng bản build hợp lệ về giấy phép)
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
