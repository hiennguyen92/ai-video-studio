/**
 * URL của ảnh khung nền chữ, theo id.
 *
 * Import từng file để trình đóng gói tự băm tên và chép ảnh: Vite cho xem trước,
 * webpack của Remotion cho bản xuất. Cả hai đều biến `import x from '*.png'`
 * thành một URL dùng được trong môi trường của mình, nên lớp vẽ không phải biết
 * đang chạy ở đâu.
 *
 * Chỉ lớp vẽ import file này. Danh mục ở `shared` chạy cả trong tiến trình main
 * và bài test, nơi không có ai biến `.png` thành URL.
 *
 * Thêm khung: thả PNG vào `resources/frames/`, khai trong `frames.json`, thêm một
 * dòng import ở đây. Test đối chiếu ba nơi đó với nhau.
 */

import confettiParty from '../../resources/frames/confetti-party.png'
import strawberry from '../../resources/frames/strawberry.png'
import watermelon from '../../resources/frames/watermelon.png'
import lemonFresh from '../../resources/frames/lemon-fresh.png'
import bubblePop from '../../resources/frames/bubble-pop.png'
import pawPrints from '../../resources/frames/paw-prints.png'
import musicNotes from '../../resources/frames/music-notes.png'
import donutSprinkles from '../../resources/frames/donut-sprinkles.png'
import ginghamPicnic from '../../resources/frames/gingham-picnic.png'
import daisyChain from '../../resources/frames/daisy-chain.png'
import cloudSun from '../../resources/frames/cloud-sun.png'
import moonStars from '../../resources/frames/moon-stars.png'
import leafyGreen from '../../resources/frames/leafy-green.png'
import ribbonBow from '../../resources/frames/ribbon-bow.png'
import spiralNotebook from '../../resources/frames/spiral-notebook.png'
import royalCrown from '../../resources/frames/royal-crown.png'
import winterSnow from '../../resources/frames/winter-snow.png'
import chalkboard from '../../resources/frames/chalkboard.png'
import woodSign from '../../resources/frames/wood-sign.png'
import rainbowCloud from '../../resources/frames/rainbow-cloud.png'
import popBurst from '../../resources/frames/pop-burst.png'
import sakuraPink from '../../resources/frames/sakura-pink.png'
import pastelPink from '../../resources/frames/pastel-pink.png'
import stickerMint from '../../resources/frames/sticker-mint.png'
import doodleInk from '../../resources/frames/doodle-ink.png'
import polkaDots from '../../resources/frames/polka-dots.png'
import candyStripes from '../../resources/frames/candy-stripes.png'
import neonPink from '../../resources/frames/neon-pink.png'
import neonCyan from '../../resources/frames/neon-cyan.png'
import chatBubble from '../../resources/frames/chat-bubble.png'
import stickyNote from '../../resources/frames/sticky-note.png'
import kraftTag from '../../resources/frames/kraft-tag.png'
import retroPixel from '../../resources/frames/retro-pixel.png'
import candyGloss from '../../resources/frames/candy-gloss.png'
import flowerCorners from '../../resources/frames/flower-corners.png'
import heartCorners from '../../resources/frames/heart-corners.png'
import frostedGlass from '../../resources/frames/frosted-glass.png'
import comicPop from '../../resources/frames/comic-pop.png'
import cloudPuff from '../../resources/frames/cloud-puff.png'
import starryNight from '../../resources/frames/starry-night.png'
import retroDouble from '../../resources/frames/retro-double.png'
import rainbowRim from '../../resources/frames/rainbow-rim.png'

const TEXT_FRAME_PNG_URLS: Record<string, string> = {
  'confetti-party': confettiParty,
  strawberry,
  watermelon,
  'lemon-fresh': lemonFresh,
  'bubble-pop': bubblePop,
  'paw-prints': pawPrints,
  'music-notes': musicNotes,
  'donut-sprinkles': donutSprinkles,
  'gingham-picnic': ginghamPicnic,
  'daisy-chain': daisyChain,
  'cloud-sun': cloudSun,
  'moon-stars': moonStars,
  'leafy-green': leafyGreen,
  'ribbon-bow': ribbonBow,
  'spiral-notebook': spiralNotebook,
  'royal-crown': royalCrown,
  'winter-snow': winterSnow,
  chalkboard,
  'wood-sign': woodSign,
  'rainbow-cloud': rainbowCloud,
  'pop-burst': popBurst,
  'sakura-pink': sakuraPink,
  'pastel-pink': pastelPink,
  'sticker-mint': stickerMint,
  'doodle-ink': doodleInk,
  'polka-dots': polkaDots,
  'candy-stripes': candyStripes,
  'neon-pink': neonPink,
  'neon-cyan': neonCyan,
  'chat-bubble': chatBubble,
  'sticky-note': stickyNote,
  'kraft-tag': kraftTag,
  'retro-pixel': retroPixel,
  'candy-gloss': candyGloss,
  'flower-corners': flowerCorners,
  'heart-corners': heartCorners,
  'frosted-glass': frostedGlass,
  'comic-pop': comicPop,
  'cloud-puff': cloudPuff,
  'starry-night': starryNight,
  'retro-double': retroDouble,
  'rainbow-rim': rainbowRim
}

/** URL ảnh của khung, hoặc `undefined` khi id không có ảnh — lớp vẽ tự bỏ khung. */
export function textFramePngUrl(styleId: string): string | undefined {
  return TEXT_FRAME_PNG_URLS[styleId]
}

/** Mọi id có ảnh. Để test kiểm danh mục không có khung nào thiếu ảnh. */
export const TEXT_FRAME_PNG_IDS: string[] = Object.keys(TEXT_FRAME_PNG_URLS)
