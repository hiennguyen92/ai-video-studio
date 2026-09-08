/**
 * Từ điển tiếng Việt — NGUỒN SỰ THẬT cho toàn bộ chuỗi giao diện.
 *
 * Tiếng Việt là ngôn ngữ mặc định của ứng dụng (DESCRIPTION §0), nên file này
 * định nghĩa luôn KIỂU của từ điển. Bản tiếng Anh phải khớp kiểu đó, nghĩa là
 * thiếu một chuỗi dịch sẽ báo lỗi lúc biên dịch chứ không âm thầm rơi về khoá.
 */
export const dictionaryVi = {
  app: {
    name: 'AI Video Studio',
    loading: 'Đang tải…',
    untitledProject: 'Dự án chưa đặt tên'
  },
  topbar: {
    project: 'Dự án',
    import: 'Nhập media',
    undo: 'Hoàn tác',
    redo: 'Làm lại',
    save: 'Lưu',
    saved: 'Đã lưu',
    saving: 'Đang lưu…',
    export: 'Xuất video',
    language: 'Ngôn ngữ',
    undoWith: 'Hoàn tác: {label}',
    redoWith: 'Làm lại: {label}',
    nothingToUndo: 'Không có gì để hoàn tác',
    nothingToRedo: 'Không có gì để làm lại'
  },
  studio: {
    title: 'AI Studio',
    tabs: {
      media: 'Media',
      voice: 'Giọng đọc',
      music: 'Nhạc nền',
      transcribe: 'Phiên âm',
      translate: 'Dịch',
      subtitles: 'Phụ đề',
      settings: 'Cấu hình AI'
    },
    comingSoon: 'Phần này sẽ có ở mốc phát triển tiếp theo.',
    comingSoonHint: 'Các thao tác chỉnh sửa thủ công vẫn dùng bình thường.'
  },
  media: {
    title: 'Thư viện media',
    importButton: 'Nhập media',
    empty: 'Chưa có media nào.',
    emptyHint: 'Nhấn "Nhập media" hoặc kéo file video, âm thanh, hình ảnh vào đây.',
    search: 'Tìm theo tên…',
    filterAll: 'Tất cả',
    filterVideo: 'Video',
    filterAudio: 'Âm thanh',
    filterImage: 'Hình ảnh',
    filterGenerated: 'AI tạo',
    importing: 'Đang nhập {count} file…',
    importedOne: 'Đã nhập {name}',
    importedMany: 'Đã nhập {count} file',
    duplicateSkipped: 'Bỏ qua {count} file đã có trong dự án',
    importFailed: 'Không nhập được {name}: {error}',
    addToTimeline: 'Thêm vào timeline',
    dragHint: 'Kéo vào timeline để dùng',
    missing: 'Thiếu file',
    noResults: 'Không có media nào khớp bộ lọc.',
    generatedBadge: 'AI'
  },
  preview: {
    title: 'Xem trước',
    empty: 'Timeline đang trống.',
    emptyHint: 'Thêm media vào timeline để xem trước tại đây.',
    play: 'Phát',
    pause: 'Tạm dừng',
    previousFrame: 'Lùi một frame',
    nextFrame: 'Tiến một frame',
    goToStart: 'Về đầu',
    goToEnd: 'Tới cuối',
    aspectRatio: 'Tỷ lệ khung hình'
  },
  inspector: {
    title: 'Thuộc tính',
    chat: 'AI Chat',
    noSelection: 'Chưa chọn đối tượng nào.',
    noSelectionHint: 'Chọn một clip trên timeline để xem và sửa thuộc tính.',
    clip: 'Clip',
    track: 'Track',
    start: 'Bắt đầu',
    duration: 'Thời lượng',
    sourceIn: 'Điểm vào nguồn',
    volume: 'Âm lượng',
    fadeIn: 'Fade in',
    fadeOut: 'Fade out',
    speed: 'Tốc độ',
    opacity: 'Độ mờ',
    scale: 'Phóng to',
    positionX: 'Vị trí X',
    positionY: 'Vị trí Y',
    resetTransform: 'Đặt lại biến đổi'
  },
  timeline: {
    title: 'Timeline',
    zoomIn: 'Phóng to',
    zoomOut: 'Thu nhỏ',
    zoomFit: 'Vừa khung',
    snap: 'Bắt dính',
    snapOn: 'Bắt dính: bật',
    snapOff: 'Bắt dính: tắt',
    split: 'Cắt tại playhead',
    deleteClip: 'Xoá clip',
    duplicateClip: 'Nhân bản clip',
    addVideoTrack: 'Thêm track video',
    addAudioTrack: 'Thêm track âm thanh',
    removeTrack: 'Xoá track',
    mute: 'Tắt tiếng',
    unmute: 'Bật tiếng',
    solo: 'Solo',
    hide: 'Ẩn',
    show: 'Hiện',
    lock: 'Khoá',
    unlock: 'Mở khoá',
    empty: 'Kéo media từ thư viện vào đây để bắt đầu.',
    trackHeight: 'Chiều cao track'
  },
  projects: {
    title: 'Dự án',
    create: 'Tạo dự án mới',
    createTitle: 'Dự án mới',
    nameLabel: 'Tên dự án',
    namePlaceholder: 'Ví dụ: Video giới thiệu sản phẩm',
    aspectLabel: 'Tỷ lệ khung hình',
    open: 'Mở',
    delete: 'Xoá',
    deleteConfirm: 'Xoá vĩnh viễn dự án "{name}"? Thao tác này không hoàn tác được.',
    empty: 'Chưa có dự án nào.',
    emptyHint: 'Tạo một dự án để bắt đầu dựng video.',
    updatedAt: 'Sửa lần cuối {time}',
    back: 'Về danh sách dự án'
  },
  export: {
    title: 'Xuất video',
    outputLabel: 'Lưu tại',
    choosePath: 'Chọn nơi lưu…',
    notChosen: 'Chưa chọn nơi lưu',
    resolution: 'Độ phân giải',
    frameRate: 'Tốc độ khung hình',
    hardware: 'Tăng tốc phần cứng',
    hardwareUnavailable: 'Máy này không có bộ mã hoá phần cứng khả dụng',
    burnSubtitles: 'Nung phụ đề vào hình',
    exportSrt: 'Xuất thêm file SRT',
    noSubtitles: 'Dự án chưa có phụ đề nào',
    start: 'Bắt đầu xuất',
    cancel: 'Huỷ xuất',
    running: 'Đang xuất…',
    preparing: 'Đang chuẩn bị…',
    succeeded: 'Xuất xong',
    failed: 'Xuất thất bại',
    cancelled: 'Đã huỷ',
    savedTo: 'Đã lưu tại {path}',
    srtSavedTo: 'Phụ đề: {path}',
    speed: 'Tốc độ {speed}×',
    emptyTimeline: 'Timeline đang trống nên chưa có gì để xuất.',
    emptyTimelineHint: 'Thêm ít nhất một clip vào timeline rồi thử lại.'
  },
  errors: {
    generic: 'Đã xảy ra lỗi: {message}',
    missingMediaTitle: 'Thiếu {count} file media',
    missingMediaHint: 'Những clip dùng các file này sẽ không phát được cho tới khi liên kết lại.',
    relink: 'Liên kết lại'
  },
  common: {
    cancel: 'Huỷ',
    confirm: 'Xác nhận',
    close: 'Đóng',
    retry: 'Thử lại',
    remove: 'Xoá',
    rename: 'Đổi tên',
    apply: 'Áp dụng',
    reset: 'Đặt lại'
  }
}

export type Dictionary = typeof dictionaryVi
