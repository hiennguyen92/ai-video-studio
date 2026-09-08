Bạn là một Senior Software Engineer chuyên xây dựng phần mềm chỉnh sửa video, ứng dụng desktop và tích hợp AI.

Hãy trực tiếp phát triển một ứng dụng AI Video Editor có thể chạy và sử dụng thực tế, dựa trên dự án tham chiếu:
https://github.com/0xsline/OpenChatCut

Tên ứng dụng tạm thời: AI Video Studio.

MỤC TIÊU

Xây dựng trình chỉnh sửa video kết hợp:
- Timeline nhiều track và preview có trải nghiệm tương tự OpenChatCut.
- Chỉnh sửa thủ công và chỉnh sửa bằng câu lệnh AI.
- Panel bên trái chuyên dùng cho các công cụ và thiết lập AI: chọn giọng đọc, lồng tiếng, nhạc nền, phiên âm, dịch và phụ đề.
- Mọi nội dung AI tạo ra đều có thể đưa vào timeline và tiếp tục chỉnh sửa.

Ưu tiên ứng dụng desktop chạy local, giao diện tiếng Việt và hỗ trợ thêm tiếng Anh.

1. NGHIÊN CỨU DỰ ÁN TRƯỚC KHI CODE

Đọc README, package.json, cấu trúc mã nguồn và các hướng dẫn phát triển của OpenChatCut.

Xác định các module phụ trách:
- Bố cục editor.
- Timeline và trạng thái project.
- Preview và đồng bộ phát.
- Import và lưu trữ media.
- AI agent và các provider.
- Phiên âm, dịch, giọng đọc và phụ đề.
- Render và export.

Ưu tiên tái sử dụng và mở rộng nền tảng hiện có. Không viết lại timeline hoặc rendering engine nếu không có lý do kỹ thuật rõ ràng.

Nếu workspace đã có dự án, kiểm tra trước khi thay đổi; không ghi đè công việc hiện có. Nếu chưa có, tạo bản phát triển từ repository tham chiếu.

Khi tái sử dụng mã nguồn, giữ các thông báo bản quyền và tuân thủ giấy phép của dự án cùng các dependency.

Nêu ngắn gọn kiến trúc dự kiến và các module sẽ sửa, sau đó bắt đầu triển khai. Không dừng ở việc viết kế hoạch.

2. BỐ CỤC GIAO DIỆN

Thiết kế giao diện dark mode chuyên nghiệp, dễ sử dụng, phù hợp làm việc nhiều giờ.

Bố cục:

┌──────────────────────────────────────────────────────────────┐
│ Toolbar: Project | Import | Undo/Redo | Save | Export          │
├────────────────┬───────────────────────────┬─────────────────┤
│                │                           │                 │
│   AI STUDIO    │       VIDEO PREVIEW       │    INSPECTOR    │
│                │                           │    / AI CHAT    │
│   Panel trái   │      Vùng trung tâm        │    Panel phải   │
│                │                           │                 │
├────────────────┴───────────────────────────┴─────────────────┤
│ Timeline toolbar | Timecode | Zoom | Snap                     │
├──────────────────────────────────────────────────────────────┤
│ Video tracks                                                 │
│ Text / Subtitle tracks                                       │
│ Voice-over tracks                                            │
│ Music / SFX tracks                                           │
└──────────────────────────────────────────────────────────────┘

Yêu cầu:
- Các panel có thể thay đổi kích thước và thu gọn.
- Timeline có thể tăng chiều cao khi cần chỉnh sửa chi tiết.
- Panel phải có tab Inspector và AI Chat.
- Thư viện media nằm trong tab riêng của panel trái.
- Có tooltip, trạng thái đang xử lý, thông báo lỗi và hướng dẫn khi chưa có dữ liệu.
- Hiển thị tốt ở màn hình 1440×900 và vẫn sử dụng được ở 1280×720.
- Dùng hệ thống component và styling hiện có nếu phù hợp.

3. PANEL TRÁI: AI STUDIO

Tổ chức thành các tab hoặc mục rõ ràng:

A. Media
- Import video, audio và hình ảnh.
- Hiển thị thumbnail, tên, thời lượng và loại file.
- Tìm kiếm và phân loại tài nguyên.
- Kéo media vào timeline.
- Nội dung AI tạo ra cũng xuất hiện ở thư viện này.

B. Giọng đọc / Lồng tiếng
- Chọn provider, model, ngôn ngữ và giọng đọc.
- Danh sách giọng đọc lấy từ provider hoặc danh mục được xác thực.
- Cho phép lọc theo ngôn ngữ và thuộc tính giọng nếu provider hỗ trợ.
- Nghe thử giọng.
- Nhập hoặc dán kịch bản.
- Điều chỉnh tốc độ, cao độ, cảm xúc nếu provider thực sự hỗ trợ.
- Chia kịch bản thành các đoạn có thể tạo lại riêng.
- Tạo audio và nghe thử trước khi chèn.
- Chọn chèn tại playhead, trên track mới hoặc thay thế đoạn đang chọn.
- Chỉnh âm lượng và fade in/out sau khi chèn.
- Lưu cấu hình giọng đọc thành preset.

Không hiển thị các tham số mà provider không hỗ trợ như thể chúng hoạt động.

C. Nhạc nền
- Upload nhạc và nghe thử.
- Chọn nhạc trong thư viện.
- Có lựa chọn tạo nhạc bằng mô tả nếu provider đã được tích hợp.
- Chọn thời lượng và các thuộc tính mà provider hỗ trợ.
- Điều chỉnh âm lượng, fade in/out.
- Loop hoặc trim nhạc theo vùng thời gian được chọn.
- Auto-ducking: tự giảm nhạc nền trong đoạn có lời nói.
- Chèn nhạc vào track riêng.

D. Phiên âm
- Chọn clip hoặc phạm vi cần xử lý.
- Tự nhận diện ngôn ngữ hoặc chọn thủ công.
- Chuyển lời nói thành văn bản có timestamp.
- Hiển thị transcript để sửa trực tiếp.
- Nhấn vào một đoạn transcript để seek preview tới vị trí tương ứng.
- Phân biệt người nói nếu provider hỗ trợ.
- Cho phép chuyển transcript thành phụ đề.

E. Dịch
- Chọn ngôn ngữ nguồn và ngôn ngữ đích.
- Dịch transcript, phụ đề hoặc kịch bản lồng tiếng.
- Hiển thị bản gốc và bản dịch song song.
- Cho phép sửa từng đoạn trước khi áp dụng.
- Giữ liên kết giữa đoạn gốc, bản dịch và timestamp.
- Có tùy chọn giữ thuật ngữ riêng bằng glossary.
- Cho phép tạo giọng đọc từ bản dịch.

Với lồng tiếng dịch:
- Tạo audio theo từng segment.
- Đo thời lượng audio thực tế.
- Phát hiện đoạn vượt quá khoảng thời gian ban đầu.
- Cho phép chọn: điều chỉnh tốc độ trong giới hạn hợp lý, sửa ngắn nội dung hoặc thay đổi thời lượng trên timeline.
- Không tự cắt mất lời nói để ép khớp thời gian.
- Không mặc định yêu cầu lip-sync trong phiên bản đầu.

F. Phụ đề
- Tạo từ transcript hoặc bản dịch.
- Nhập và xuất SRT.
- Chỉnh font, kích thước, màu chữ, viền, nền và vị trí.
- Hỗ trợ hiển thị tiếng Việt đầy đủ dấu.
- Cho phép phụ đề song ngữ.
- Có một số preset dễ đọc.
- Phụ đề là dữ liệu có thể chỉnh sửa trên timeline.

G. Cấu hình AI
- Quản lý provider, API key và model theo từng tác vụ.
- Kiểm tra kết nối.
- Hiển thị capability của provider.
- Lưu thiết lập mặc định và preset.
- Khi chưa có API key, chỉ vô hiệu hóa tính năng phụ thuộc tương ứng.
- Các thao tác chỉnh sửa local vẫn sử dụng được.

Phân biệt cấu hình mặc định toàn ứng dụng với lựa chọn riêng của từng project.

4. TIMELINE VÀ PREVIEW

Giữ các khả năng chỉnh sửa hiện có của OpenChatCut. Tối thiểu phải hoạt động:
- Nhiều track video, audio và text/subtitle.
- Kéo thả, di chuyển, trim và split clip.
- Xóa, nhân bản và thay đổi thứ tự clip/track.
- Snapping, zoom timeline và cuộn.
- Playhead, time ruler, thumbnail và waveform.
- Mute, lock và ẩn track phù hợp với loại track.
- Undo/redo cho thao tác thủ công và thay đổi do AI.
- Phím tắt cơ bản; không kích hoạt khi người dùng đang nhập văn bản.

Preview:
- Play/pause, seek và tiến/lùi từng frame.
- Đồng bộ playhead, hình ảnh, audio và phụ đề.
- Chọn tỷ lệ khung hình 16:9, 9:16 và 1:1.
- Hiển thị transform và các hiệu ứng đã hỗ trợ.
- Tận dụng cùng dữ liệu composition cho preview và export.
- Không tạo hai nguồn trạng thái timeline độc lập.

AI tạo giọng đọc, nhạc hoặc phụ đề xong phải tạo asset và clip thật trong project, có thể kéo, cắt, sửa và undo.

5. AI CHAT

Cho phép nhập các yêu cầu như:
- “Tạo giọng đọc tiếng Việt từ kịch bản này.”
- “Dịch phụ đề sang tiếng Anh.”
- “Thêm nhạc nền nhẹ và giảm nhạc khi có người nói.”
- “Cắt clip đang chọn tại vị trí 5 giây.”
- “Tạo phụ đề cho đoạn video đang chọn.”

AI phải:
- Đọc project, clip được chọn, playhead và thiết lập AI Studio.
- Sử dụng các command/tool chỉnh sửa được kiểm tra dữ liệu.
- Không tự sửa project JSON bằng đầu ra văn bản không xác thực.
- Hiển thị tiến trình và mô tả thay đổi.
- Với thay đổi nhiều bước, tạo bản đề xuất có thể xem trước rồi áp dụng.
- Gom một nhóm thay đổi thành một bước undo hợp lý.
- Phát hiện project đã thay đổi trong lúc AI xử lý để tránh ghi đè chỉnh sửa mới.
- Giữ lại lịch sử hội thoại theo project.

Cấu hình AI Studio và AI Chat phải dùng chung nguồn dữ liệu.

6. KIẾN TRÚC VÀ TÍCH HỢP

Ưu tiên stack và phiên bản tương thích với repository hiện tại; kiểm tra dependency trước khi chọn phiên bản.

Tách rõ:
- UI.
- Editor commands và project state.
- Media processing.
- AI provider adapters.
- Background jobs.
- Persistence.
- Export.

Mỗi nhóm tác vụ AI có interface riêng:
- Text generation / translation.
- Speech-to-text.
- Text-to-speech.
- Music generation.

Không hardcode model hoặc API endpoint theo trí nhớ. Đọc tài liệu chính thức và xác minh API trước khi tích hợp.

Chọn bộ provider tối thiểu để triển khai trọn luồng phiên âm → dịch → giọng đọc. Chỉ thêm nhiều provider sau khi luồng chính chạy được.

Các job dài cần:
- Trạng thái queued/running/succeeded/failed/cancelled.
- Tiến trình nếu backend cung cấp; không giả phần trăm.
- Hủy, thử lại và thông báo lỗi dễ hiểu.
- Chống chèn trùng asset khi retry.
- Lưu kết quả đã tạo để sử dụng lại.

API key chỉ được lưu và sử dụng phía dịch vụ local hoặc cơ chế lưu bí mật phù hợp của desktop; không đưa vào frontend bundle, project JSON hoặc log.

Xử lý audio/video nặng ở worker hoặc process nền để tránh treo UI.

7. DỮ LIỆU VÀ LƯU PROJECT

Ưu tiên mở rộng schema hiện có.

Project cần lưu:
- Media references.
- Tracks và clips.
- Transcript segments.
- Bản dịch.
- Phụ đề.
- Liên kết tới audio AI đã tạo.
- Thiết lập AI theo project, không chứa bí mật.
- Version schema để hỗ trợ migration.

Bảo đảm:
- Timeline dùng quy ước thời gian thống nhất; chuyển đổi timestamp và frame có quy tắc làm tròn rõ ràng.
- Chỉnh sửa không phá hủy file nguồn.
- Autosave và mở lại project.
- Phát hiện media bị thiếu và cho phép liên kết lại.
- Kết quả job không được chèn nhầm sang project khác khi người dùng đổi project.

8. EXPORT

Tối thiểu:
- Xuất MP4 có hình, âm thanh và phụ đề đúng với preview.
- Chọn độ phân giải và frame rate trong phạm vi đã hỗ trợ.
- Bật/tắt burn-in phụ đề.
- Xuất phụ đề SRT riêng.
- Hiển thị tiến trình, lỗi và đường dẫn file kết quả.

Render từ một snapshot project cố định để thao tác chỉnh sửa trong lúc export không làm sai kết quả.

9. CÁCH TRIỂN KHAI

Chia thành các mốc có thể chạy và kiểm tra:

Mốc 1:
- Chạy được nền tảng hiện có.
- Hoàn thiện bố cục AI Studio / Preview / Inspector–Chat / Timeline.
- Import, chỉnh sửa cơ bản, save/reopen và export hoạt động.

Mốc 2:
- Tích hợp giọng đọc thật.
- Upload nhạc, chèn nhạc và điều chỉnh âm lượng.
- Hoàn thiện vòng đời background job.

Mốc 3:
- Phiên âm, dịch, phụ đề.
- Tạo lồng tiếng theo segment và xử lý chênh lệch thời lượng.

Mốc 4:
- Kết nối AI Chat với thiết lập AI Studio.
- Hoàn thiện đề xuất thay đổi, undo và auto-ducking.
- Tích hợp tạo nhạc nếu có provider phù hợp.

Các tính năng nâng cao đã có phải được giữ lại. Tính năng chưa có như tạo video AI, hiệu ứng nâng cao hoặc tracking được ghi vào backlog rõ ràng.

Sau mỗi mốc:
- Chạy ứng dụng và kiểm tra luồng vừa triển khai.
- Chạy kiểm tra phù hợp với thay đổi.
- Báo rõ phần đã hoạt động, phần chưa kiểm chứng và phần còn thiếu.
- Tiếp tục mốc kế tiếp nếu không có blocker thực sự.

10. TIÊU CHÍ NGHIỆM THU

Kiểm chứng bằng một project mẫu:
1. Import video có lời nói khoảng 30–60 giây.
2. Kéo vào timeline, split và trim.
3. Tạo transcript, sửa một đoạn và sinh phụ đề.
4. Dịch sang ngôn ngữ khác.
5. Chọn giọng, nghe thử và tạo lồng tiếng.
6. Thêm nhạc nền, giảm nhạc tại đoạn có giọng đọc.
7. Preview đúng hình, tiếng và phụ đề.
8. Undo/redo một thay đổi do AI.
9. Đóng rồi mở lại project và kiểm tra dữ liệu.
10. Export MP4 và phát lại file để kiểm tra nội dung, thời lượng và đồng bộ.

Kiểm tra thêm:
- API key thiếu hoặc sai.
- Provider bị timeout.
- Hủy job và retry.
- Media bị thiếu.
- Đổi project khi job còn chạy.
- Bản dịch dài hơn segment nguồn.

Không coi mock data là tích hợp AI đã hoàn thành. Nếu thiếu credentials, kiểm tra adapter bằng fixture có ghi nhãn rõ ràng và báo rằng cuộc gọi provider thật chưa được kiểm chứng.

ĐẦU RA

Hãy cung cấp:
- Mã nguồn đã triển khai trong workspace.
- Hướng dẫn cài đặt và chạy.
- File cấu hình môi trường mẫu không chứa khóa thật.
- Mô tả ngắn kiến trúc và các module đã thay đổi.
- Kết quả kiểm tra thực tế.
- Danh sách giới hạn hoặc tính năng chưa hoàn tất.

Bắt đầu bằng việc kiểm tra repository và workspace, trình bày ngắn phương án triển khai, rồi viết code.