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

## Đo preview (Remotion Player)

Chạy lại bằng `node spikes/remotion-player-benchmark/bench.mjs`. Đo trong
**Electron thật**, không phải Chromium rời — đúng môi trường app sẽ chạy. Cùng
bản dựng 1080×1920, 8 cảnh, crossfade, phụ đề nảy chữ.

| Phép đo | Kết quả |
|---|---|
| Phát | **29,7 / 30 fps** (99% tốc độ thật) |
| Hình có đổi thật khi phát | 3/3 ảnh chụp khác nhau |
| Tua — cập nhật trạng thái | 6ms (trung vị) |
| Tua — tới lúc **hình đổi** | **516ms** (trung vị) |
| Cùng phép đo trên `<video>` trần | **402ms** (trung vị) |
| Remotion đắt hơn video trần | **1,28×** |

**Phát mượt.** Giữ gần đúng 30fps, và ảnh chụp trong lúc phát khác nhau nên hình
thật sự có vẽ chứ không phải đồng hồ chạy suông.

**Tua mất khoảng nửa giây mới đổi hình — nhưng đó KHÔNG phải giá của Remotion.**
Thẻ `<video>` trần trên cùng file, đo bằng đúng phương pháp, mất 402ms. Đây là giá
cố hữu của việc tua H.264 tới vị trí không phải khung khoá, và **preview hiện tại
của app cũng đang trả đúng khoản đó**. Remotion chỉ cộng thêm ~28%.

### Cách đo và giới hạn của nó

Con số "cập nhật trạng thái" (6ms) chỉ đo React, **không** đo hình — ban đầu tôi
đo cửa sổ ẩn và ra 9ms, một con số vô nghĩa vì cửa sổ ẩn có thể không vẽ gì cả.
Phải bật cửa sổ hiện và **chụp ảnh so từng byte** mới biết hình có đổi thật.

Vòng lặp chụp ảnh tranh tài nguyên với việc giải mã nên **thổi phồng cả hai phía**.
Vì vậy **tỉ lệ 1,28× đáng tin hơn hai con số tuyệt đối**.

## Chưa đo

- Preview trong app THẬT, có nhiều track và lớp phụ đề chồng lên — phép đo trên
  dùng một composition độc lập.
- Footage thật từ điện thoại (HEVC, bitrate cao) — footage trong phép đo là tổng
  hợp bằng ffmpeg, giải mã nhẹ hơn thực tế.
- Video dài hơn 25 giây. Mục tiêu là video ngắn nên chưa cần, nhưng thời gian gần
  như tỉ lệ thuận với thời lượng.
