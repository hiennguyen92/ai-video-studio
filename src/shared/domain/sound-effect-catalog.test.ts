import { describe, expect, it } from 'vitest'
import {
  LEGACY_SOUND_EFFECT_IDS,
  SOUND_EFFECTS,
  findSoundEffect,
  soundEffectFileName
} from './sound-effect-catalog'

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

  it('thời lượng nằm trong khoảng hợp lý', () => {
    // Hiệu ứng lặp (gõ phím, đồng hồ) dài cả phút là có chủ ý: người dùng cắt
    // theo độ dài cảnh. Trần này chỉ chặn nhầm một bản nhạc vào thư viện.
    for (const effect of SOUND_EFFECTS) {
      expect(effect.durationUs).toBeGreaterThan(50_000)
      expect(effect.durationUs).toBeLessThanOrEqual(90_000_000)
    }
  })

  it('tra được theo id, id lạ trả undefined', () => {
    expect(findSoundEffect('clean-ding')?.nameEn).toBe('Clean ding')
    expect(findSoundEffect('khong-co')).toBeUndefined()
  })

  it('id của bản cũ dẫn sang một hiệu ứng có thật', () => {
    // Dự án cũ lưu id cũ. Dẫn sang id không tồn tại thì mở lại dự án vẫn báo
    // thiếu media — đúng thứ bảng ánh xạ này sinh ra để chống.
    for (const [legacy, current] of Object.entries(LEGACY_SOUND_EFFECT_IDS)) {
      expect(findSoundEffect(legacy)?.id).toBe(current)
    }
  })

  it('tên file dựng từ id, một chỗ duy nhất', () => {
    expect(soundEffectFileName('pop')).toBe('pop.mp3')
  })
})
