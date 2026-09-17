import type { ProjectDocument } from './project-document-types'

/**
 * Effect nào đang bật chế độ SOI, và đếm xem dự án còn bao nhiêu chỗ như vậy.
 *
 * Chế độ soi vẽ đè màu lên khung để người dùng nhìn thấy effect đang chọn vùng
 * nào mà chỉnh. Nó là thông số bình thường, lưu vào file dự án và được bản xuất
 * vẽ y hệt preview — đó là điều kiện tiên quyết của cả hệ effect (`EffectRecipe`
 * là hàm thuần theo khung hình, không biết mình đang vẽ cho preview hay bản
 * xuất) nên KHÔNG tách hai đường vẽ để "tự tắt khi xuất".
 *
 * Vì vậy chặn ở chỗ khác: hộp thoại Xuất video hỏi hàm này rồi cảnh báo. Quên
 * tắt mà xuất thì ra file loang màu, và người dùng chỉ phát hiện sau khi đã đăng.
 */

/** `kind` effect → khoá thông số bật chế độ soi. Giá trị `'on'` là đang bật. */
const PREVIEW_MODE_PARAM_BY_EFFECT: Record<string, string> = {
  'skin-smooth': 'showArea'
}

/** Số clip đang có ít nhất một effect bật chế độ soi. */
export function countClipsInEffectPreviewMode(document: ProjectDocument | null): number {
  if (!document) return 0
  let count = 0
  for (const track of document.tracks) {
    for (const clip of track.clips) {
      const hit = clip.effects?.some((effect) => {
        const key = PREVIEW_MODE_PARAM_BY_EFFECT[effect.kind]
        return key !== undefined && effect.params[key] === 'on'
      })
      if (hit) count += 1
    }
  }
  return count
}
