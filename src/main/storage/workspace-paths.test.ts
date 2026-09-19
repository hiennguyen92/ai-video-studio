import { describe, expect, it } from 'vitest'
import { projectPaths } from './workspace-paths'

describe('projectPaths', () => {
  it('id do app sinh: nhận', () => {
    expect(projectPaths('project_lz3k9abc12').root).toMatch(/project_lz3k9abc12$/)
  })

  it('id trỏ ra ngoài thư mục dự án: từ chối, trước khi ai kịp xoá gì', () => {
    for (const id of ['../../Documents', '..', 'a/b', '', 'x\\y']) {
      expect(() => projectPaths(id)).toThrow(/không hợp lệ/)
    }
  })
})
