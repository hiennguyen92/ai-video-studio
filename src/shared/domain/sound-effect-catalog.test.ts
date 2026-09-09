import { describe, expect, it } from 'vitest'
import { SOUND_EFFECTS, findSoundEffect, soundEffectFileName } from './sound-effect-catalog'

describe('danh mục hiệu ứng âm thanh', () => {
  it('id là duy nhất', () => {
    // Trùng id thì `findSoundEffect` trả về cái đầu tiên và cái sau không bao giờ
    // dùng được — im lặng hoàn toàn.
    const ids = SOUND_EFFECTS.map((effect) => effect.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('id an toàn để làm tên file', () => {
    // Id đi thẳng vào tên file và vào bộ chọn CSS/đường dẫn; khoảng trắng hay
    // dấu gạch chéo ở đây là một lỗ hổng chứ không phải chuyện thẩm mỹ.
    for (const effect of SOUND_EFFECTS) {
      expect(effect.id).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('mọi mục đều có tên hai thứ tiếng và từ khoá', () => {
    // Từ khoá là thứ DUY NHẤT agent dựa vào để chọn — nó không nghe được file.
    for (const effect of SOUND_EFFECTS) {
      expect(effect.nameVi.length).toBeGreaterThan(0)
      expect(effect.nameEn.length).toBeGreaterThan(0)
      expect(effect.tags.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('thời lượng nằm trong khoảng hợp lý của một hiệu ứng', () => {
    for (const effect of SOUND_EFFECTS) {
      expect(effect.durationUs).toBeGreaterThan(50_000)
      expect(effect.durationUs).toBeLessThanOrEqual(3_000_000)
    }
  })

  it('bảng màu giữ nhỏ có chủ đích', () => {
    // Hai mươi lăm cái dùng được hơn hai trăm cái phải lục. Con số này là một
    // quyết định, không phải một sự tình cờ — chạm trần thì phải bỏ bớt.
    expect(SOUND_EFFECTS.length).toBeLessThanOrEqual(25)
  })

  it('tra được theo id, id lạ trả undefined', () => {
    expect(findSoundEffect('whoosh-fast')?.nameEn).toBe('Fast whoosh')
    expect(findSoundEffect('khong-co')).toBeUndefined()
  })

  it('tên file dựng từ id, một chỗ duy nhất', () => {
    expect(soundEffectFileName('pop')).toBe('pop.mp3')
  })
})
