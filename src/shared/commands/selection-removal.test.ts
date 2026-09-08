import { describe, expect, it } from 'vitest'
import { selectionRemovalCommands } from './selection-removal'

describe('selectionRemovalCommands', () => {
  it('không chọn gì thì không có lệnh nào', () => {
    // `null` chứ không phải mảng rỗng: nơi gọi cần phân biệt để làm mờ nút, và
    // để không ghi một bước hoàn tác chẳng làm gì.
    expect(selectionRemovalCommands({ clipIds: [] })).toBeNull()
  })

  it('xoá clip đang chọn', () => {
    const removal = selectionRemovalCommands({ clipIds: ['clip_1', 'clip_2'] })
    expect(removal?.commands).toEqual([
      { type: 'clip/remove', clipId: 'clip_1' },
      { type: 'clip/remove', clipId: 'clip_2' }
    ])
  })

  it('xoá chữ đè hình bằng lệnh của chữ, không phải lệnh của clip', () => {
    const removal = selectionRemovalCommands({
      clipIds: [],
      text: { kind: 'overlay', overlayId: 'text_1' }
    })
    expect(removal?.commands).toEqual([{ type: 'text/remove', overlayId: 'text_1' }])
  })

  it('xoá câu phụ đề kèm track chứa nó', () => {
    const removal = selectionRemovalCommands({
      clipIds: [],
      text: { kind: 'subtitle', subtitleTrackId: 'sub_1', cueId: 'cue_9' }
    })
    // Thiếu trackId thì reducer không tìm ra cue và từ chối IM LẶNG.
    expect(removal?.commands).toEqual([
      { type: 'subtitle/remove-cue', trackId: 'sub_1', cueId: 'cue_9' }
    ])
  })

  it('khối chữ được ưu tiên khi vùng chọn còn sót id clip', () => {
    // Không nên xảy ra vì mọi hàm đặt vùng chọn đều dựng object mới, nhưng nếu
    // xảy ra thì phải xoá thứ người dùng vừa bấm — không phải xoá cả một clip mà
    // họ không còn thấy được chọn nữa.
    const removal = selectionRemovalCommands({
      clipIds: ['clip_1'],
      text: { kind: 'overlay', overlayId: 'text_1' }
    })
    expect(removal?.commands).toEqual([{ type: 'text/remove', overlayId: 'text_1' }])
  })

  it('mỗi loại có nhãn hoàn tác riêng', () => {
    expect(selectionRemovalCommands({ clipIds: ['clip_1'] })?.label).toBe('Xoá clip')
    expect(
      selectionRemovalCommands({ clipIds: [], text: { kind: 'overlay', overlayId: 'a' } })?.label
    ).toBe('Xoá chữ')
    expect(
      selectionRemovalCommands({
        clipIds: [],
        text: { kind: 'subtitle', subtitleTrackId: 'a', cueId: 'b' }
      })?.label
    ).toBe('Xoá câu phụ đề')
  })
})
