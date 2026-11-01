/**
 * 图片预处理：把用户随手选的一张图整理成「能被图床接受 + 显示效果正确」的方图。
 *
 * 为什么要做这一步（2026-10-26 实测酷狗图床 `imgphp.kugou.com/imageupload/stream.php`）：
 * - **宽、高都必须 ≥ 400px**，否则返回 `Bad width` / `Bad height`。手机截图、头像、
 *   表情包常常小于这个尺寸，直接传必失败。
 * - **单边上限 8192px**，超过返回 `Bad width` / `Bad height`。
 * - **文件体积上限 3MB**（3.00MB 通过、3.05MB 报 `Too big`）。相机原图轻松超。
 * - 歌单封面在界面上永远是 1:1 方图，非方图会被 `object-fit: cover` 裁掉两侧，
 *   用户看不到自己以为的那块区域 —— 与其让平台裁，不如本地先按中心裁好。
 *
 * 所以这里统一做：中心裁正方形 → 缩放到 512px → 编码为 JPEG（体积可控）。
 * 512 是权衡：远高于 400 下限、显示端最大也就 480（`{size}` 占位），再大纯属浪费流量。
 */

/** 输出边长。≥400 满足图床下限，且覆盖所有显示尺寸（最大 480） */
const TARGET_SIZE = 512

/** JPEG 质量。0.9 在 512×512 下约 60–120KB，远低于 3MB 上限 */
const JPEG_QUALITY = 0.9

/** 图床硬性下限（实测：399 报错，400 通过） */
export const COVER_MIN_EDGE = 400

/** 图床硬性上限（实测：8192 通过，8193 报错） */
export const COVER_MAX_EDGE = 8192

/** 图床文件体积上限（实测：3.00MB 通过，3.05MB 报 Too big） */
export const COVER_MAX_BYTES = 3 * 1024 * 1024

/** 读图失败（文件损坏、不是图片、浏览器不支持该格式） */
export class ImageLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageLoadError'
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImageLoadError('无法读取这张图片，请换一张试试'))
    }
    image.src = url
  })
}

/**
 * 把任意图片整理成 512×512 的 JPEG。
 *
 * 小图会被**放大**到 512 而不是保持原尺寸 —— 图床要求 ≥400，放大后虽然不会更清晰，
 * 但能通过校验，且比「直接拒绝用户」体验好。放大用 canvas 默认的双线性插值即可。
 */
export async function prepareCoverImage(file: File): Promise<File> {
  if (file.size === 0) {
    throw new ImageLoadError('图片内容为空，请重新选择')
  }

  const image = await loadImage(file)

  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) {
    throw new ImageLoadError('无法读取这张图片的尺寸，请换一张试试')
  }
  if (width > COVER_MAX_EDGE || height > COVER_MAX_EDGE) {
    // 超大图不直接拒绝：裁切后可能就合规了，让 canvas 处理
    // 但极端尺寸（如 30000px）会让 canvas 分配失败，这里设一个保护线
    if (width > 16384 || height > 16384) {
      throw new ImageLoadError('图片尺寸过大（超过 16384px），请先缩小后再上传')
    }
  }

  // 中心裁正方形：取短边作为裁剪边长，左上角按差值的一半偏移
  const edge = Math.min(width, height)
  const sx = Math.floor((width - edge) / 2)
  const sy = Math.floor((height - edge) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = TARGET_SIZE
  canvas.height = TARGET_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new ImageLoadError('当前环境无法处理图片')
  }
  // 透明 PNG 转 JPEG 会变黑底，先铺白
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, sx, sy, edge, edge, 0, 0, TARGET_SIZE, TARGET_SIZE)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  })
  if (!blob) {
    throw new ImageLoadError('图片处理失败，请换一张试试')
  }
  if (blob.size > COVER_MAX_BYTES) {
    throw new ImageLoadError('图片处理后仍然过大，请换一张试试')
  }

  // 统一改名为 .jpg：图床按扩展名分派，压缩后内容确实是 JPEG，
  // 沿用原文件名（如 .png）会让图床按错误格式处理。
  return new File([blob], 'cover.jpg', { type: 'image/jpeg' })
}
