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
| Adapter ElevenLabs (danh sách giọng từ provider) | ✅ | **gọi API thật**: model, giọng, sinh audio tiếng Việt 7,20s |
| Adapter OpenAI (danh mục giọng cố định) | ⚠️ | fixture — chưa có khoá OpenAI để gọi thật |
| Chỉ hiện tham số provider thật sự hỗ trợ | ✅ | e2e: đổi model thì ô tham số biến mất |
| Chia kịch bản thành đoạn tạo lại riêng | ✅ | 9 unit + e2e |
| Chèn tại playhead / track mới / thay clip đang chọn | ✅ | `use-audio-insertion.ts` |
| Upload nhạc, chèn vào track riêng, chỉnh âm lượng/fade | ✅ | e2e, chạy khi không có khoá nào |
| Vòng đời job đầy đủ, huỷ thật, chống chèn trùng khi retry | ✅ | 10 unit |
| Thiếu khoá chỉ vô hiệu hoá tính năng phụ thuộc | ✅ | e2e |
| Khoá sai báo lỗi rõ ràng | ✅ | e2e (chạm mạng thật, nhận 401) |

**Đã trả xong nợ Mốc 2** bằng một lần chạy thật với khoá ElevenLabs. Lần chạy đó sửa năm chỗ sai
mà fixture không phát hiện được (xem README, mục "Đã kiểm chứng bằng API thật").

**Còn lại:** OpenAI TTS vẫn chưa gọi thật lần nào — cần một khoá OpenAI.

## Mốc 3 — Phiên âm, dịch, phụ đề

- [ ] Phiên âm có timestamp, chọn clip hoặc khoảng thời gian, tự nhận diện ngôn ngữ
- [ ] Trình soạn transcript, nhấn vào đoạn để tua preview tới đúng vị trí
- [ ] Phân biệt người nói khi provider hỗ trợ
- [ ] Dịch giữ liên kết theo từng segment, hiển thị song song, sửa được từng đoạn, có glossary
- [ ] Giao diện tạo và sửa phụ đề (mô hình dữ liệu, ghi ASS/SRT, nung vào video **đã xong**)
- [ ] Phụ đề song ngữ và các preset dễ đọc
- [ ] Lồng tiếng theo bản dịch: tạo từng segment, **đo thời lượng thật**, phát hiện tràn giờ
- [ ] Khi tràn giờ: cho chọn tăng tốc trong giới hạn / rút ngắn nội dung / kéo dài trên timeline.
      **Không bao giờ tự cắt mất lời nói.**

## Mốc 4 — AI Chat và hoàn thiện

- [ ] AI Chat dùng chung cấu hình với AI Studio
- [ ] Chat đọc được project, clip đang chọn, playhead
- [ ] Tool chỉnh sửa có kiểm tra dữ liệu, ánh xạ sang tập lệnh sẵn có
- [ ] Thay đổi nhiều bước tạo bản đề xuất xem trước được rồi mới áp dụng
- [ ] Phát hiện project đã đổi trong lúc AI chạy
- [ ] Lịch sử hội thoại lưu theo project
- [ ] Auto-ducking: giảm nhạc nền tại đoạn có lời nói
- [ ] Tạo nhạc bằng mô tả, nếu tìm được provider có API công khai ổn định

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
- Ảo hoá timeline khi số clip rất lớn

## Câu hỏi còn mở

1. **Khoá OpenAI** để gọi thật adapter OpenAI TTS một lần. ElevenLabs đã xác nhận xong.
2. **Phiên âm chạy local hay trên cloud?** Whisper chạy local thì miễn phí và giữ dữ liệu trong máy,
   đổi lại nặng vài trăm MB model và chậm hơn. Ảnh hưởng tới kích thước bản cài.
3. **Ngưỡng tăng tốc khi lồng tiếng.** Hiện đặt mặc định 1.3×; con số này nên do người dùng chỉnh hay
   cố định?
