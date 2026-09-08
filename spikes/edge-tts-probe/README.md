# Dò giao thức Edge TTS

Ba script này dùng để XÁC MINH giao thức trước khi viết adapter, không phải để
chạy trong app. Giữ lại vì mọi con số trong `src/main/ai/edge-tts-protocol.ts`
đều đến từ đây, và khi Microsoft đổi giao thức thì đây là chỗ dò lại.

| Script | Trả lời câu hỏi | Kết quả đo được |
|--------|-----------------|-----------------|
| `probe.mjs` | luồng có ra audio không, header nào bắt buộc | chỉ `User-Agent` là bắt buộc; thiếu nó → 403. `Origin` một mình vẫn 403 |
| `formats.mjs` | định dạng nào chạy, prosody nào có tác dụng | mp3 48k/96k và webm opus chạy; mp3 48 kHz và riff PCM luôn 0 byte. rate/pitch/volume đều có tác dụng |
| `length.mjs` | một lần gọi dài được bao nhiêu | 6.000 ký tự (8.038 byte) vẫn đủ audio; 2.500 ký tự trượt hai lần rồi lần khác lại chạy — thất bại là chập chờn, không theo độ dài |

Chạy: `node spikes/edge-tts-probe/probe.mjs`
