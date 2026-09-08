# Kiến trúc hệ thống

Tài liệu này giải thích **vì sao** hệ thống được chia như hiện tại. Chi tiết API nằm trong chính mã nguồn.

## Ba tiến trình

| Tiến trình | Chạy cái gì | Không được làm gì |
|---|---|---|
| **main** | Đĩa, tiến trình con ffmpeg, hộp thoại hệ thống, (sau này) khoá API | Không giữ trạng thái project |
| **preload** | Cầu nối `contextBridge`, danh sách hàm được phép | Không import package ngoài |
| **renderer** | Toàn bộ giao diện và trạng thái project | Không chạm đĩa, không chạy tiến trình con |

Renderer chạy với `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.

**Preload bắt buộc là CommonJS.** Preload trong sandbox không nạp được ESM và không resolve được
`node_modules`. Vi phạm điều này thì preload im lặng không nạp: `window.api` biến mất và mọi lời gọi
IPC ném lỗi ngay trong renderer, không có thông báo nào ở tiến trình main. `electron.vite.config.ts`
vì vậy ép định dạng `cjs` cho preload.

## Quy ước thời gian

Đơn vị chuẩn là **microgiây số nguyên**, hậu tố `Us` trên mọi trường.

Vị trí luôn **tuyệt đối**: mỗi clip lưu `startUs` trên timeline và `sourceInUs` trong asset. Không có
chỗ nào tính vị trí bằng cách cộng dồn các clip đứng trước, nên sai số làm tròn không tích luỹ dù
người dùng kéo cắt bao nhiêu lần.

Frame rate lưu dạng phân số `{ num, den }` — 29.97 fps là `30000/1001`, không phải `29.97`.
Quy đổi frame chỉ xảy ra ở **đúng hai chỗ**: khi bắt dính thao tác chuột, và khi export.
Quy tắc làm tròn duy nhất là làm tròn nửa lên, cài trong `roundHalfUp`.

## Đường ghi duy nhất

```
Thao tác người dùng ─┐
                     ├─→ EditorCommand ─→ schema zod ─→ reducer thuần ─→ patch immer ─→ document
Thao tác AI (sắp có) ┘                                                        │
                                                                              └─→ lịch sử undo
```

Không có đường nào khác ghi vào project document. Điều này quyết định vì:

- AI sẽ chỉ phát ra command, và payload phải qua được schema. Nó **không** được ghi JSON thẳng từ
  đầu ra văn bản chưa xác thực.
- Mọi bất biến (clip không chồng lấn, luôn sắp xếp, không vượt quá vật liệu nguồn) do reducer bảo đảm,
  chứ không trông chờ nơi gọi tự giữ.
- Một **giao dịch** gồm nhiều command chỉ tạo một bước hoàn tác, và có tính nguyên tử: một command
  lỗi thì cả nhóm bị huỷ. Nhờ vậy một thay đổi nhiều bước do AI thực hiện được hoàn tác trong một lần.

Lịch sử lưu **patch** chứ không lưu bản sao document — một project có hàng trăm clip và hàng nghìn
segment transcript, sao chép nguyên document sau mỗi lần kéo chuột sẽ ngốn bộ nhớ rất nhanh.

`document.revision` tăng đúng một lần cho mỗi giao dịch. Job AI dài sẽ chụp lại revision lúc bắt đầu
và so lại trước khi ghi, để phát hiện project đã đổi trong lúc AI chạy.

## Một bộ giải composition cho cả xem trước và xuất

`shared/domain/composition-resolver.ts` trả lời câu hỏi "tại mốc thời gian T thì hiển thị và nghe thấy gì".
Cả bản xem trước lẫn bộ dựng lệnh export đều gọi hàm này.

Đây là điểm mấu chốt: nếu mỗi bên tự tính lấy, bản xem trước và file xuất ra sẽ lệch nhau theo kiểu
rất khó truy — người dùng thấy đúng trên màn hình nhưng file xuất ra lại sai.

Cùng nguyên tắc đó áp cho phụ đề: `SubtitleStyle` được mô tả bằng khái niệm của ASS (alignment kiểu
bàn phím số, outline, margin). Bản xem trước suy ra CSS từ mô hình đó, còn lớp export sinh file ASS
từ chính mô hình đó.

## Xem trước

Đồng hồ chủ là **thời gian thực** (`performance.now`), không phải `currentTime` của thẻ video nào.
Có nhiều clip trên nhiều track cùng phát; lấy một thẻ bất kỳ làm đồng hồ sẽ khiến các track trôi khỏi
nhau mỗi khi thẻ đó nghẽn hoặc đang seek.

Một vòng lặp `requestAnimationFrame` duy nhất đẩy playhead và kéo mọi thẻ media về đúng vị trí.
Việc đồng bộ đi qua một sổ đăng ký ref nằm **ngoài React** — đẩy nó qua state sẽ khiến cả cây render
lại 60 lần mỗi giây.

Lệch dưới 120 ms thì để thẻ tự chạy; vượt ngưỡng mới seek cứng. Gán `currentTime` liên tục gây giật
hình và lục cục tiếng.

## Xuất video

Bộ dựng lệnh (`timeline-filter-graph-builder.ts`) là **hàm thuần**, không chạy tiến trình nào, nên
kiểm thử được chính chuỗi tham số sinh ra. Lỗi ở lớp này — sai offset, sai thứ tự lớp, quên chuẩn hoá
âm lượng — biểu hiện thành file xuất sai và rất khó truy nếu chỉ nhìn kết quả cuối.

Chiến lược: một `filter_complex` duy nhất.

- Nền là nguồn `color` dài bằng cả timeline, nên khoảng trống thành đen thay vì làm ngắn video.
- Mỗi clip được cắt, dịch PTS về đúng vị trí, rồi `overlay` với `enable=between(...)`.
- Audio trộn bằng `amix` với **`normalize=0`**. Thiếu tham số này ffmpeg sẽ chia âm lượng cho số đầu
  vào, khiến thêm một track nhạc lại làm nhỏ cả lời thoại.
- `-fps_mode cfr` ép nhịp hình cố định; thiếu nó thời lượng có thể trôi khỏi timeline.

Render đọc từ một **bản chụp document đã đóng băng**, nên người dùng chỉnh sửa tiếp trong lúc xuất
không làm sai kết quả.

Tiến trình lấy từ `-progress pipe:1` — số thật do ffmpeg báo. Khi ffmpeg chưa báo mốc nào, giao diện
hiện sọc chạy vô định chứ **không bịa phần trăm**.

## ffmpeg đi kèm

Ứng dụng luôn dùng bản ffmpeg đi kèm, không dùng bản của máy. Lý do đã kiểm chứng: ffmpeg cài bằng
Homebrew trên macOS được build thiếu `libass`, `libfreetype` và `fontconfig`, tức là **không có filter
`subtitles` và `drawtext`** — nung phụ đề sẽ hỏng âm thầm. Bản đi kèm bật đủ ba thứ đó; có một phép
thử tích hợp kiểm tra đúng điều này.

## Chuỗi lời nói: phiên âm → dịch → phụ đề → lồng tiếng

Bốn lớp dữ liệu này nằm TÁCH RIÊNG và nối với nhau bằng id, không lồng vào nhau:

- `Transcript.segments[].id` là mỏ neo. Mốc thời gian chỉ được lưu ở đây.
- `TranslationSegment.sourceSegmentId` trỏ ngược về đoạn gốc; bản dịch **không**
  giữ mốc thời gian riêng, nên không bao giờ có hai nguồn thời gian lệch nhau.
- `SubtitleCue.sourceSegmentId` giữ đường truy ngược về đoạn đã sinh ra nó.
- `DubbingSegment.sourceSegmentId` cũng vậy, còn khoảng thời gian mục tiêu lấy từ
  đoạn gốc.

Chỗ dễ sai nhất là **đổi hệ toạ độ**. Transcript đếm giờ theo ASSET (giây thứ mấy
trong file gốc), còn phụ đề và preview đếm theo TIMELINE. Việc quy đổi nằm gọn
trong `subtitle-cue-builder.ts` và phải xử lý ba chuyện không hiển nhiên: đoạn nằm
ngoài phần clip đã cắt thì bỏ hẳn, đoạn chớm mép thì cắt cụt theo phần còn thấy,
và một asset dùng lại ở nhiều clip thì sinh nhiều cue.

### Vì sao kết quả của mô hình ngôn ngữ luôn bị kiểm lại

Dịch được gửi đi theo lô kèm id và kết quả được ghép lại THEO ID, không theo thứ
tự. Mô hình rất hay gộp câu, tách câu, bỏ sót đoạn cuối hoặc đánh số lại. Lệch một
đoạn ở đây sẽ làm sai giờ toàn bộ phụ đề và lồng tiếng dựng lên trên, mà lại không
gây lỗi nào để lần ra. Vì vậy id thiếu được hỏi lại riêng, id lạ bị bỏ, và đoạn nào
mô hình không dịch nổi thì giữ nguyên bản gốc — số đoạn ra luôn bằng số đoạn vào.

### Vì sao lồng tiếng không bao giờ bị cắt

Thời lượng audio tạo ra được **đo bằng ffprobe**, không ước lượng theo số ký tự:
tốc độ đọc khác nhau rất nhiều theo giọng và theo ngôn ngữ. Khi audio dài hơn
khoảng gốc, `dubbing-overflow-planner.ts` chỉ đưa ra ba lối thoát — tăng tốc trong
ngưỡng nghe được, rút ngắn lời, hoặc kéo dài timeline. Không có nhánh nào cắt bớt
audio. Chưa chọn hướng thì đoạn giữ nguyên độ dài thật và bị đánh dấu còn tràn.

## Lưu trữ

Project là một file JSON, ghi theo kiểu **nguyên tử**: ghi ra file tạm rồi đổi tên đè lên file thật.
Ghi thẳng vào `project.json` mà mất điện giữa chừng là mất trắng cả project.

Chọn JSON thay vì SQLite vì tài liệu project được đọc/ghi trọn vẹn theo từng lần, không cần truy vấn
từng phần; JSON còn đọc được bằng mắt và diff được khi cần gỡ lỗi. Nếu sau này chỉ mục media lớn tới
mức cần truy vấn, có thể thêm SQLite riêng cho chỉ mục mà không đụng tới tài liệu project.

`schemaVersion` gác cổng migrate; mỗi bước là một hàm `vN -> vN+1` chạy tuần tự và không sửa lại bước cũ.

## Vì sao i18n tự viết

Chỉ có hai ngôn ngữ, không cần số nhiều phức tạp hay tải từ điển từ xa. Đổi lại, cách này cho phép
truy cập theo kiểu `t.timeline.split`: gõ sai khoá là **lỗi biên dịch**, và bản tiếng Anh thiếu chuỗi
cũng là **lỗi biên dịch** vì nó được ràng buộc kiểu theo từ điển tiếng Việt. Thư viện i18n dùng khoá
dạng chuỗi nên cả hai lỗi đó chỉ lộ ra lúc chạy.

Tiếng Việt luôn là mặc định, không suy ra từ ngôn ngữ hệ điều hành.
