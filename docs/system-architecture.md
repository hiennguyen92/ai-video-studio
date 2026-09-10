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

## AI Chat: vì sao mô hình không chạm được vào project

Yêu cầu cứng của đề bài là "không tự sửa project JSON bằng đầu ra văn bản không
xác thực". Cách thực hiện: mô hình **không có** đường ghi nào. Nó chỉ phát ra lời
gọi công cụ, và lời gọi đó phải qua ba cửa trước khi thành thay đổi:

1. tên công cụ phải nằm trong danh mục cố định (`chat-tool-catalog.ts`);
2. tham số phải qua schema của chính công cụ đó;
3. bộ dựng (`chat-tool-planner.ts`) đổi nó thành `EditorCommand` — đúng tập lệnh
   mà thao tác tay dùng, nên được kiểm tra và hoàn tác y hệt.

Bị chặn ở đây gồm: tên công cụ bịa, id clip/track không tồn tại, sai kiểu, `NaN`,
`Infinity`, âm lượng ngoài khoảng, điểm cắt nằm ngoài clip. Một bước hỏng không
làm đổ những bước còn lại; lý do từ chối được hiện ra chứ không nuốt đi.

Công cụ nhận **giây**, không phải micro giây: mô hình xử lý số nhỏ quen thuộc
đáng tin hơn hẳn, và việc quy đổi về đơn vị chuẩn nằm gọn một chỗ.

Thay đổi không bao giờ tự áp dụng. Chúng thành một **bản đề xuất** đọc được, người
dùng bấm mới chạy, và chạy thành đúng một bước hoàn tác. Bản đề xuất ghi lại
`revision` lúc dựng; nếu dự án đã đổi kể từ đó thì nó bị từ chối, vì các id bên
trong có thể đã trỏ vào clip không còn tồn tại.

Lịch sử hội thoại nằm ở `chat.json` cạnh `project.json`, không nằm trong tài liệu
project: hội thoại không phải nội dung biên tập nên không được vào lịch sử hoàn
tác, và nó chỉ dài thêm chứ không co lại.

## Giảm nhạc khi có lời nói

Mô hình clip chỉ có **một mức âm lượng cho cả clip**, không có đường automation.
Nên cách làm là cắt clip nhạc tại ranh giới lời nói rồi hạ âm lượng những mảnh
trùng. Hệ quả: mức đổi theo **bậc thang**, không mượt.

Không thể lấy fadeIn/fadeOut làm dốc, vì chúng luôn ramp từ/về IM LẶNG — nhạc sẽ
tụt xuống 0 rồi mới lên lại, nghe tệ hơn hẳn một bậc nhảy. Muốn dốc thật thì phải
thêm automation âm lượng vào mô hình clip.

Âm lượng được đặt **tuyệt đối** cho cả mảnh bị giảm lẫn mảnh không, nên chạy lại
lần hai cho ra đúng kết quả lần một; nhân dồn sẽ làm nhạc nhỏ dần sau mỗi lần chạy.

Tính năng này gọi được từ AI Chat, nhưng cũng có nút riêng trong tab Nhạc nền:
chat cần một máy chủ LLM, còn đây là thao tác thuần cục bộ.

## Dựng từ footage KHÔNG có tiếng

Đường dựng theo transcript chỉ chạy khi footage có lời nói. Video quay review sản
phẩm thường **không có tiếng** — transcript rỗng, agent không có gì để đọc. Đó là
một nhánh khác hẳn, không phải một biến thể nhỏ.

Nhánh này dựa trên **phát hiện cú máy**: bộ lọc `select='gt(scene,…)'` của ffmpeg
chấm điểm khác biệt giữa hai khung liền nhau, `metadata=print` in ra mốc vượt
ngưỡng. Mỗi cú được trích một ảnh đại diện lấy **ở giữa cú** — khung ngay sau chỗ
cắt hay dính mờ chuyển động, nhìn không ra nội dung.

**Đường dẫn ảnh là phần quan trọng nhất.** `list_shots` trả về chúng, và agent nào
đọc được file — Claude Code chẳng hạn — sẽ *xem* từng cú mà chọn, thay vì đoán theo
mốc thời gian. Không có nó thì cả nhánh này vô nghĩa.

`build_cut_from_shots` giữ **đúng thứ tự agent đưa ra**, khác hẳn
`build_cut_from_transcript` vốn luôn xếp theo thứ tự lời nói. Với footage câm, sắp
xếp lại cảnh *chính là* việc dựng phim.

Cú máy quá ngắn bị gộp vào cú trước: footage thật có chớp sáng, lóe đèn, khung mờ
khi lia máy — mỗi thứ sinh một "cảnh" vài phần trăm giây mà không ai gọi là cú máy.

**Dò chuyển cảnh một mình là không đủ.** Footage review quay bằng điện thoại thường
là MỘT cú máy liên tục: ffmpeg trả về không mốc nào (đo thật trên một clip 98 giây:
0 mốc ở ngưỡng 0,3 và cả ở 0,1), và agent nhận đúng một ảnh cho cả video. Nên cú nào
dài hơn 6 giây bị **chia đều** thành lát. Chia đều chứ không cắt cứng từng 6 giây,
để không sinh ra lát cuối dài nửa giây.

Lát chia đều mang cờ `synthetic` và `list_shots` nói thẳng điều đó ra: cắt ở một mốc
chia đều rơi vào giữa động tác, khác hẳn cắt ở chỗ chuyển cảnh thật. Giấu đi thì agent
tưởng mình đang cắt đúng chỗ chuyển cảnh.

Kết quả dò được lưu trong cache của project như thumbnail hay waveform: xoá đi vẫn
dò lại được, nên nó không thuộc tài liệu project.

### Khung hình và chuyển cảnh cũng phải gọi được từ agent

Hai công cụ dễ bị bỏ sót nhưng thiếu thì cả nhánh này không ra được video TikTok:

- `set_canvas` — footage dọc đặt trong khung 16:9 thì hai bên là hai dải đen, và
  **không công cụ nào khác sửa được**. Nhận TỈ LỆ (`9:16`) chứ không nhận hai số
  pixel: mô hình nhớ sai độ phân giải thường xuyên. Cạnh luôn được làm chẵn — h264
  với yuv420p không mã hoá được cạnh lẻ, và lỗi đó chỉ lộ ra lúc xuất.
- `set_clip_transition` — chuyển cảnh kéo clip đến bắt đầu sớm hơn để phủ lên clip
  đi, nên nó ăn vào phần nguồn nằm TRƯỚC `sourceInUs`. Dựng bằng `insert_clip` với
  điểm vào nằm sâu trong file thì luôn đủ handle; dựng từ đầu file thì không.

### Giọng đọc không cần khoá

Mọi provider giọng đọc khác đều đòi khoá API và tính tiền, nên trước đây một máy
mới cài KHÔNG chạy hết được luồng aff. `edge-tts` lấp chỗ đó: dùng chính dịch vụ
đọc văn bản của trình duyệt Edge, không đăng ký, không tính tiền, có 2 giọng
tiếng Việt (HoaiMy nữ, NamMinh nam). Nó đứng đầu danh sách TTS nên là mặc định.

Đánh đổi phải nói thẳng: đây là endpoint nội bộ của Edge, không tài liệu, không
cam kết ổn định. Vì vậy mọi hằng số trong `edge-tts-protocol.ts` đều kèm số đo
thật, và có một nhóm test gọi thật (`AVS_LIVE_EDGE_TTS=1`) làm chuông báo khi
Microsoft đổi giao thức.

Ba điều đo được mà tài liệu chép tay sẽ không nói:

- thiếu header `User-Agent` → 403 ngay ở bước bắt tay; `Origin` một mình không đủ
- `X-Timestamp` phải theo kiểu chuỗi Date của JavaScript. Gửi RFC 1123
  (`toUTCString()`) thì kết nối vẫn mở, vẫn nhận `turn.start`, nhưng KHÔNG có byte
  audio nào — hỏng im lặng
- cùng một yêu cầu hợp lệ **thỉnh thoảng trả về rỗng** rồi lần sau lại chạy: 2.500
  ký tự trượt hai lần liền trong khi 6.000 ký tự chạy tốt. Nên adapter thử lại tới
  ba lần khi ra rỗng; không thử lại thì người dùng nhận một file audio 0 byte làm
  giọng đọc và chỉ phát hiện lúc phát video

### Luồng đầy đủ cho video aff từ footage câm

1. dò cú máy → agent xem ảnh, chọn và xếp cảnh
2. agent viết kịch bản → TTS sinh giọng đọc
3. phiên âm chính file giọng đọc đó → phụ đề khớp giọng
4. chữ overlay cho hook và CTA
5. nhạc nền + giảm nhạc dưới giọng đọc
6. chuyển cảnh giữa các cảnh
7. xuất bằng Remotion (bắt buộc, vì có chuyển cảnh và chữ overlay)

## MCP: agent bên ngoài dựng phim

App mở một máy chủ MCP trên `127.0.0.1` (Streamable HTTP, đường dẫn
`/api/external-mcp/mcp`), để Claude Code hoặc agent khác đọc và dựng dự án đang mở.

**Một danh mục công cụ, hai lối vào.** Công cụ ghi của MCP sinh THẲNG từ
`chatToolSchemas` — đúng danh mục mà AI Chat trong app dùng — và đi qua đúng
`chat-tool-planner` để hoá thành `EditorCommand`. Không có đường ghi riêng nào cho
agent ngoài, nên hai lối vào không thể lệch nhau về quy tắc kiểm tra.

**Vì sao HTTP chứ không stdio:** app là một cửa sổ GUI đang chạy sẵn. stdio buộc
client tự khởi động tiến trình server, tức là mở thêm một instance thứ hai của
trình dựng phim. HTTP cho phép nối vào đúng cửa sổ người dùng đang làm việc.

**Tài liệu vẫn chỉ có một nguồn.** Máy chủ MCP nằm ở main, còn project nằm ở
renderer cùng lịch sử hoàn tác. Main **không** giữ bản sao — nó hỏi renderer qua
`mcp-renderer-bridge`. Nhân bản document sang main là tạo nguồn sự thật thứ hai và
sẽ lệch ngay lần đầu người dùng bấm Ctrl+Z.

**Khác AI Chat một điểm có chủ ý:** agent ngoài **áp dụng ngay, không chờ duyệt
từng bước**. Một agent dựng phim phát ra hàng chục lời gọi; bắt duyệt từng cái là
bỏ đi ý nghĩa của việc tự động. Lưới an toàn là hoàn tác — mỗi lời gọi là một bước
undo, hiện trong lịch sử như mọi thao tác tay.

**Bảo mật:** khoá ngẫu nhiên sinh mới mỗi lần mở app, chỉ nghe loopback, và không
công cụ nào đọc được credential. Cổng cục bộ sửa được dự án nên vẫn phải có khoá —
mọi tiến trình trên máy đều gọi được nó.

### Công cụ dựng phim cho agent

Ngoài nhóm sửa vặt sẵn có, agent cần nhóm ĐỌC (`get_project_overview`,
`get_transcript`, `list_media` — có kèm đường dẫn thumbnail/filmstrip để agent nào
xem được ảnh thì chọn cảnh bằng hình) và nhóm DỰNG:

- `build_cut_from_transcript` — trục chính của dựng phim theo lời nói. Một lượt
  gọi ra cả bản dựng, thay vì để mô hình phát hàng chục lệnh cắt/xoá/dời rời rạc.
  Luôn xếp theo **thứ tự transcript**, không theo thứ tự mô hình liệt kê id.
- `insert_clip`, `ripple_delete_range`, `add_track`.

`timeline/ripple-delete` là lệnh mới ở tầng reducer: xoá một khoảng rồi kéo phần
sau lùi lên lấp chỗ trống, và dời cue phụ đề theo để phụ đề không lệch khỏi hình.

## Lớp render Remotion

Bên cạnh đường xuất ffmpeg sẵn có, dự án có thêm đường xuất bằng Remotion. Người
dùng chọn trong hộp thoại Xuất.

**Vì sao có hai:** ffmpeg nhanh hơn ~6,7 lần, nhưng filter graph của nó không làm
được chuyển cảnh và chữ động. Remotion làm được, và quan trọng hơn — nó dùng
**chung một composition với preview**, nên bản xuất không thể lệch bản xem trước.
Đường ffmpeg phải giữ hai hiện thực khớp nhau bằng tay.

**Bộ dựng được chọn theo NỘI DUNG dự án, không theo một mặc định cố định.** ffmpeg
vẫn được dùng khi dùng được, vì nó nhanh hơn hẳn. Nhưng dự án có chuyển cảnh hoặc
chữ overlay thì app tự chuyển sang Remotion và khoá lựa chọn lại — xuất bằng ffmpeg
lúc đó cho ra file **thiếu hiệu ứng mà không báo gì**, kiểu hỏng tệ nhất vì người
dùng chỉ phát hiện khi đã đăng video lên. `requiresRemotionRenderer()` là chỗ quyết
định, và giao diện nói rõ vì sao không đổi được.

### Ba lớp

```
ProjectDocument (micro giây)
   │  buildRenderPlan()           ← hàm THUẦN, có test bằng con số cụ thể
   ▼
RenderPlan (khung hình)
   │
   ├─► ProjectComposition ──► @remotion/player   (preview — ĐANG DÙNG)
   └─► ProjectComposition ──► renderMedia        (xuất file — tuỳ chọn)
```

Preview đã chuyển hẳn sang Player: lớp cũ tự xếp thẻ `<video>` và lớp phủ phụ đề
riêng đã bị gỡ. Nhờ vậy `usePlaybackEngine` — bộ đồng bộ thẻ media viết tay — cũng
không còn cần, và phụ đề chỉ còn MỘT nơi vẽ.

### Đồng bộ đầu phát hai chiều

Player và store đều giữ vị trí đang phát, và nối thẳng hai chiều sẽ thành vòng lặp
vô tận:

- Player chạy → `frameupdate` → cập nhật store (timeline, timecode đi theo)
- store đổi từ chỗ khác (bấm thước, nhấn đoạn transcript) → `seekTo`

Cờ `syncingFromPlayer` đánh dấu chiều đang chạy để chiều kia đứng yên, và chiều
tua chỉ kích hoạt khi lệch quá một khung — gọi `seekTo` mỗi khung sẽ làm giật hình
lúc phát.

Quy đổi micro giây → khung hình nằm gọn trong `buildRenderPlan`, không rải trong
component. Lệch một khung ở đó thì hình và tiếng lệch cả bản dựng mà không có lỗi
nào báo ra.

### Chuyển cảnh

Chuyển cảnh là **hiệu ứng vẽ trên chính clip đến**, phủ dần lên clip đi phía dưới:
mờ chồng, trượt, gạt ngang, phóng vào. Không có phép trộn hai luồng nào, nên tất
cả biểu diễn được bằng CSS thuần và chạy y hệt ở preview lẫn lúc xuất.

**Vì sao không dùng `xfade` của ffmpeg:** nó là toán tử tuần tự, nuốt hai luồng
nhả ra một luồng, và **làm CO độ dài** — nối năm chuyển cảnh 0,5s là mọi thứ phía
sau lệch 2,5 giây so với thứ preview hiển thị. Dự án này lấy vị trí tuyệt đối làm
nguồn sự thật nên đó là điều không chấp nhận được.

Cách làm ở đây giữ nguyên vị trí tuyệt đối: clip đến **bắt đầu sớm hơn** đúng bằng
thời lượng chuyển cảnh, và điểm vào nguồn lùi tương ứng — tức là nó tiêu thụ phần
nguồn nằm trước điểm vào, đúng khái niệm *handle* của các trình dựng phim. Tổng
thời lượng timeline không đổi, không clip nào bị đẩy đi.

Thời lượng bị **kẹp** theo cái nhỏ nhất trong ba giới hạn: phần nguồn còn phía
trước, vị trí trên timeline (không lùi qua mốc 0), và độ dài chính clip. Kẹp chứ
không từ chối — đặt 1 giây trên clip chỉ còn 0,3 giây handle thì nên được 0,3 giây.
Giao diện **nói ra** khi bị kẹp, nếu không người dùng sẽ thấy hiệu ứng chớp qua mà
không hiểu vì sao.

Hệ quả: **clip đầu timeline không bao giờ có chuyển cảnh** — không có gì phía trước
để lấy, và cũng không có gì để phủ lên.

### Nhập media qua MCP

`import_media` là công cụ ghi **bình thường**, nằm trong `chatToolSchemas` như 37
cái còn lại và đi qua đúng `chat-tool-planner`. Không có đường tắt riêng.

Nhập media phải probe file, băm nội dung và dựng thumbnail — bất đồng bộ, mà
planner là hàm THUẦN và ĐỒNG BỘ. Cách gỡ: nơi gọi **chuẩn bị trước**, đúng khuôn
đã có sẵn cho hiệu ứng âm thanh (`resolveSoundEffects`) và phông chữ
(`resolveFontFiles`). `resolveImportedMedia` dựng asset rồi đưa vào
`ChatEditContext.importedMedia`, planner chỉ phát lệnh `asset/add`.

Ranh giới quan trọng: hàm chuẩn bị **chỉ dựng asset, không ghi** vào document.
Ghi ở cả hai nơi thì một lần nhập thành hai bước hoàn tác và asset vào document
hai lần. Vì thế `use-media-import.ts` có hai tầng — `prepareMediaImport` (dựng)
và `importMediaPaths` (dựng rồi ghi, cho nút bấm trên giao diện).

Hai chốt chặn:

- **Đường dẫn phải TUYỆT ĐỐI.** Agent chạy ở thư mục của nó, tiến trình main lại
  ở thư mục khác, nên đường dẫn tương đối không có nghĩa. Chặn sớm và nói rõ cái
  nào sai, thay vì để nó thành lỗi "không tìm thấy file" mà agent sẽ đi sửa nhầm.
- **File trùng báo kèm id của bản đã có**, không nhập hai lần. Im lặng bỏ qua thì
  agent tưởng nhập hỏng và nhập lại mãi.

Id của từng asset nằm trong **mô tả bước**, vì đó là thứ duy nhất agent đọc được
sau khi áp dụng — không có nó thì nó phải gọi thêm `list_media` mới đặt được clip.

Một hệ quả phải xử riêng: nhập một file **đã có sẵn** là bước hợp lệ nhưng không
sinh lệnh nào. Cầu MCP trước đây coi "không có lệnh" là thất bại và nuốt luôn mô
tả, nên agent nhận câu trả lời rỗng rồi gọi lại mãi. Nay bước không sinh lệnh vẫn
được báo cáo.

### Khoá truy cập của máy chủ MCP

Khoá sinh mới mỗi lần mở app, chỉ nghe trên `127.0.0.1`. **Tắt được**, vì có
client MCP không gửi được header tuỳ ý — nhưng tắt nghĩa là mọi tiến trình trên
máy đều sửa được dự án đang mở, nên giao diện nói thẳng điều đó bằng một khối cảnh
báo chứ không giấu trong tài liệu.

Ba điều đáng ghi:

- **Kiểm ở từng yêu cầu**, không chốt lúc khởi động. Bật tắt có hiệu lực ngay,
  không phải mở lại app.
- **Không dựng lại máy chủ khi bật tắt.** Khoá vẫn sinh ra và vẫn giữ nguyên, chỉ
  là chốt kiểm bỏ qua nó — nên bật lại là dùng đúng khoá cũ, client đang nối không
  phải cấu hình lại. Đổi lại: khi đang tắt thì ô khoá **không hiện**, vì bày một
  ô khoá không có tác dụng sẽ làm người dùng tưởng nó vẫn đang bảo vệ.
- **Hỏng về phía đóng.** File cấu hình rác, thiếu trường, hay bị sửa bậy đều rơi
  về BẬT. Chỉ đúng giá trị `false` mới tắt — `"false"` hay `0` là file hỏng chứ
  không phải ý định tắt, và đoán bừa theo hướng tắt là mở cửa ngoài ý muốn.

Cấu hình lưu theo MÁY (`mcp-config.json` trong userData), không theo dự án: máy
chủ cục bộ là chuyện của máy này.

### Tốc độ phát clip

Đổi tốc độ **giữ nguyên khoảng nguồn** và đổi độ dài trên timeline: tốc độ 2× làm
clip ngắn đi một nửa, vẫn đúng đoạn phim đó. Làm ngược lại — giữ độ dài, đổi
khoảng nguồn — thì tăng tốc sẽ đòi nhiều phim hơn số đang có và bất biến
`sourceInUs + durationUs * speed <= thời lượng asset` vỡ ngay.

Vì thế `clip/set-speed` là lệnh riêng chứ không đi qua `clip/update`: nó không chỉ
ghi một trường mà còn đổi độ dài, và clip dài ra có thể lấn clip bên cạnh. Nó đi
qua `placeClip` như trim và move, nên theo đúng chính sách ghi đè có sẵn.

Chỉ áp cho clip hình và clip tiếng. Ảnh tĩnh không có trục thời gian nguồn, nên
"phát nhanh gấp đôi" vô nghĩa — kéo dài ngắn một tấm ảnh là việc của cắt mép.

**Một khác biệt giữa hai đường dựng, có sẵn từ trước:** ffmpeg đổi tốc độ tiếng
bằng `atempo` nên GIỮ cao độ, còn Remotion dùng `playbackRate` nên cao độ ĐỔI
theo. Xem trước và bản xuất Remotion sẽ nghe cao giọng hơn bản xuất ffmpeg ở cùng
một clip tăng tốc.

### Chữ đè lên hình

`TextOverlay` là dữ liệu RIÊNG, không phải phụ đề — dù nhìn qua đều là chữ trên
hình. Phụ đề sinh ra TỪ lời nói và bám mốc thời gian của transcript; chữ overlay do
người dùng hoặc AI tự viết, tự đặt giờ. Gộp chúng làm một thì "dựng lại phụ đề từ
bản dịch" sẽ xoá mất dòng CTA người dùng gõ tay.

Kiểu chữ dùng lại `SubtitleStyle` thay vì mô hình song song: cùng cần cỡ chữ, màu,
viền, nền hộp, vị trí kiểu bàn phím số và lề. Mặc định khác phụ đề có chủ ý — chữ
TO hơn và nằm GIỮA khung hình, vì hook và CTA phải đập vào mắt.

Overlay vẽ **sau cùng**, trên cả phụ đề: hook mà bị phụ đề che thì mất tác dụng.
Nó cũng tính vào `projectDurationUs`, nếu không một CTA đặt sau clip cuối sẽ bị cắt
mất khi xuất.

#### Khung nền dễ thương

Trường `frame` nằm trên `TextOverlay`, **không** nằm trong `SubtitleStyle` — cùng
lý do đã giới hạn `glow`: bản nung phụ đề đi qua ASS, mà ASS chỉ vẽ được nền đặc
một màu (`BorderStyle 3`), nên đặt ở đó là đẻ ra một ô điều khiển chết cho phụ đề.

Dự án lưu **id bền** (`styleId`, `paletteId`, `decorId`), không lưu SVG và không
lưu màu: hình vẽ với bảng màu là mã nguồn, sửa được và dựng lại được; chép chúng
vào file project là đóng băng một bản cũ.

Khung co theo chữ bằng `border-image` chín ô: góc vẽ đúng bằng bề dày viền nên
**không méo** dù chữ dài hay ngắn, mép thì lát gạch. Đuôi bong bóng và trang trí
góc không đi qua cơ chế đó được — nó lát mép nên thứ gì cần nằm đúng một chỗ sẽ bị
nhân lên thành cả hàng — nên chúng là phần tử đặt tuyệt đối.

Tra danh mục nằm ở **tầng dựng kế hoạch**, không nằm lúc vẽ. Id lạ (project của bản
app mới hơn, id đã bỏ, agent gõ sai) hạ về "không khung": chữ vẫn hiện, chỉ mất
khung. Ném lỗi lúc vẽ thì hỏng cả video. Ngược lại, **công cụ AI thì ném lỗi** kèm
danh sách id hợp lệ — bản dựng phải chịu đựng dữ liệu xấu, còn công cụ phải nói ra
để agent sửa được.

Khung và nền hộp phẳng **loại trừ nhau**, và lớp vẽ tự chốt điều đó chứ không dựa
vào lời dặn: giao diện chỉ cho chọn một trong hai, nhưng đường MCP đặt được cả hai
bằng hai lệnh rời.

Lệnh đặt khung có **ba** trạng thái: bỏ trống là giữ nguyên, đối tượng là đặt,
`null` là bỏ khung. Mẫu một dòng dùng cho `glow` không đủ ở đây — boolean không cần
trạng thái xoá vì `false` đã là tắt.

Công cụ AI nhận vị trí bằng chữ (`top`/`middle`/`bottom`) chứ không bắt mô hình
đoán số bàn phím 1–9 của ASS — đó là loại giá trị mô hình rất hay điền sai.

Trường mới này thêm qua `fillDefaults` chứ không tăng `schemaVersion`: nó không phá
tương thích, dự án cũ mở lên chỉ cần một mảng rỗng.

### Máy chủ media cục bộ

Remotion **không đọc được đường dẫn file tuỳ ý** — asset phải nằm dưới `publicDir`
hoặc phục vụ qua `http://`. Scheme `avstudio-media://` không dùng được vì bộ dựng
khung hình là **tiến trình riêng**, không phải Chromium của Electron.

Nên có `local-media-server.ts`: HTTP trên loopback, hỗ trợ Range (thiếu thì thẻ
video phải tải trọn file mới phát được). Nó **không nhận đường dẫn từ URL** — chỉ
phục vụ những asset renderer đã đăng ký, tra theo id. Kèm token vì cổng loopback
thì mọi tiến trình trên máy đều gọi được.

### Ba cái bẫy đã gặp

- **`interface` không có index signature ngầm, `type` thì có.** `Composition` của
  Remotion đòi props gán được vào `Record<string, unknown>`, nên props phải khai
  bằng `type`.
- **Remotion phải nằm trong `dependencies`, không phải `devDependencies`.**
  electron-vite chỉ externalize `dependencies`; để ở dev thì `@remotion/renderer`
  bị nhồi vào bundle main và build hỏng.
- **CSP chặn máy chủ media cục bộ.** `media-src` cũ chỉ cho `'self'` và
  `avstudio-media:`, nên Player nạp `http://127.0.0.1:*` bị từ chối và video chỉ
  hiện ô đen — không có lỗi nào nổi lên giao diện, chỉ có một dòng trong console.
  Đã mở `media-src`/`img-src`/`connect-src` cho **loopback**, không mở cho http
  nói chung. Remotion còn dùng một đoạn `data:audio` làm chỗ giữ chỗ nên `data:`
  cũng phải được phép.

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
