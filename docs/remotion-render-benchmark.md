# Đo tốc độ render Remotion

Mục đích: quyết định có thay lớp render bằng Remotion hay không, trước khi viết
code. Chạy lại bằng `node spikes/remotion-benchmark/bench.mjs`.

## Điều kiện đo

- Máy: 10 lõi, 32 GiB RAM (macOS)
- Bản dựng: **1080×1920 @ 30fps, 25 giây** — đúng khuôn video aff TikTok
- 8 cảnh, crossfade 0,5s giữa các cảnh, phụ đề nảy chữ theo từng từ
- Cấu hình render copy từ `external/OpenChatCut/remotion/performance.mjs`
  (`concurrency=8`, `offthreadVideoThreads=3`, `gl: angle`) để không đo một
  Remotion chưa tinh chỉnh
- Mốc so sánh: đường xuất ffmpeg hiện tại (cắt + nung phụ đề ASS + `h264_videotoolbox`)

## Kết quả

| Kịch bản | Thời gian | So với thời lượng video |
|---|---|---|
| ffmpeg (đường hiện tại) | **4,1s** | 0,16× |
| Remotion, tăng tốc phần cứng | **27,2s** | 1,09× |
| Remotion, mã hoá phần mềm | 36,8s | 1,47× |
| Remotion, bỏ crossfade | 26,2s | 1,05× |
| Remotion, **chỉ lớp đồ hoạ** (nền trong suốt) | 40,1s | 1,61× |

- Remotion chậm hơn ffmpeg **6,7 lần**
- Tăng tốc phần cứng giúp **26%**
- Bundle: 1,1s, chỉ tốn một lần

## Ba kết luận

**1. Remotion đủ nhanh cho video ngắn.** 27 giây để xuất một video 25 giây là
chấp nhận được khi sửa tới lui. Cách xa ngưỡng "vài phút" đủ để loại bỏ phương án.

**2. Crossfade gần như miễn phí (1,04×).** Giả định "chồng hai luồng video lúc
chuyển cảnh là phần đắt nhất" **sai**. Nút thắt không nằm ở giải mã video.

**3. Phương án lai — Remotion chỉ render lớp đồ hoạ rồi ffmpeg ghép — KHÔNG đáng
làm.** Đây là điều lật ngược khuyến nghị trước đó:

- Lớp đồ hoạ một mình **chậm hơn** cả bản đầy đủ (40,1s so với 27,2s)
- Sinh file trung gian **508 MB** cho 25 giây (ProRes 4444 giữ kênh alpha)
- Lý do: nút thắt là vẽ khung hình và mã hoá, **không phải** giải mã video. Bỏ
  video đi không tiết kiệm được gì, mà còn phải trả giá cho một codec nặng.

Suy ra: **nếu dùng Remotion thì dùng cho cả lớp hình**, đúng như OpenChatCut làm.
Không chia đôi.

## Ràng buộc phát hiện thêm

**Remotion không đọc được đường dẫn file tuỳ ý.** Asset phải nằm dưới `publicDir`
hoặc được phục vụ qua `http://`. Với một trình dựng phim mà media nằm khắp nơi
trên đĩa, đây là việc phải xử lý khi tích hợp thật — nhiều khả năng phải mở một
máy chủ HTTP cục bộ cho media. Giao thức `avstudio-media://` sẵn có **không dùng
được**, vì bộ dựng khung hình của Remotion là tiến trình riêng, không phải Chromium
của Electron.

## Chưa đo

- **Tốc độ preview bằng Remotion Player trong app.** Đây là thứ ảnh hưởng tới trải
  nghiệm hằng ngày nhiều hơn cả tốc độ xuất, và cần một spike riêng.
- Footage thật từ điện thoại (HEVC, bitrate cao) — footage trong phép đo là tổng
  hợp bằng ffmpeg, giải mã nhẹ hơn thực tế.
- Video dài hơn 25 giây. Mục tiêu là video ngắn nên chưa cần, nhưng thời gian gần
  như tỉ lệ thuận với thời lượng.
