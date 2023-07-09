import { Context, Schema, h, version } from 'koishi'
import { Canvas } from 'skia-canvas'
export const name = 'imagify-skia'

type Ground = {
  type: 'color',
  color?: string
} | {
  type: 'linearGradient',
  angle: number,
  colorStop: [number, string][]
} | {
  type: 'pattern',
  pattern: any
} | {
  type?: ''
}

// type Ground = {
//   type: 'color' | 'linearGradient' | 'pattern'
//   color?: string
//   angle?: number
//   colorStop?: [number, string]
//   pattern?: any
// }

export interface Config {
  maxLineCount: number
  maxLength: number
  // background: string
  // blur: number,
  imageMinWidth: number,
  imageMaxWidth: {
    auto?: false,
    maxWidth?: number,
  },
  lineHeight: number,
  fontSize: number,
  font: string,
  padding: Record<'left' | 'right' | 'top' | 'bottom', number>,
  background: Ground,
  foreground: Ground
}

export const Config: Schema<Config> = Schema.object({
  maxLineCount: Schema.number().min(1).default(20).description('当文本行数超过该值时转为图片'),
  maxLength: Schema.number().min(1).default(600).description('当返回的文本字数超过该值时转为图片'),
  imageMinWidth: Schema.number().min(100).default(200).description('图片最小宽度，单位 px'),
  imageMaxWidth: Schema.intersect([
    Schema.object({
      auto: Schema.boolean().default(true).description('是否自动识别')
    }),
    Schema.union([
      Schema.object({
        auto: Schema.const(false).required(),
        maxWidth: Schema.number().min(300).default(400).description('图片最大宽度，单位 px')
      }),
      Schema.object({})
    ]),
  ]),
  lineHeight: Schema.number().min(0).default(0).description('文字行高，为0则不设置'),
  fontSize: Schema.number().min(0).default(20).description('文字大小'),
  font: Schema.string().default('Microsoft YaHei, sans-serif').description('字体，类似 css 语法'),
  padding: Schema.object({
    left: Schema.number().min(0).default(20).description('内边距'),
    right: Schema.number().min(0).default(20).description('内边距'),
    top: Schema.number().min(0).default(20).description('内边距'),
    bottom: Schema.number().min(0).default(20).description('内边距')
  }),
  background: Schema.intersect([
    Schema.object({
      type: Schema.union<'color' | 'linearGradient' | 'pattern'>(['color', 'linearGradient'/* , 'pattern' */]).description('是时候学习了： [fillStyle](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasRenderingContext2D/fillStyle)'),
    }),
    Schema.union([
      Schema.object({
        type: Schema.const('color').required(),
        color: Schema.string().description('color').default('white')
      }),
      Schema.object({
        type: Schema.const('linearGradient').required(),
        angle: Schema.number().min(0).max(359).default(0).description('角度，单位 deg'),
        colorStop: Schema.array(Schema.tuple([
          Schema.number().min(0).max(1).step(0.01).default(0).role('slider').description('offset'),
          Schema.string().description('color')
        ]).description('[偏移量,颜色]')).description('是时候学习了 [CanvasGradient.addColorStop](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasGradient/addColorStop)')
      }),
      Schema.object({
        type: Schema.const('pattern').required(),
        pattern: Schema.string().description('还没做好')
      }),
      Schema.object({})
    ])
  ]).description('背景填充'),
  foreground: Schema.intersect([
    Schema.object({
      type: Schema.union<'color' | 'linearGradient' | 'pattern'>(['color', 'linearGradient'/* , 'pattern' */]).description('是时候学习了： [fillStyle](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasRenderingContext2D/fillStyle)'),
    }),
    Schema.union([
      Schema.object({
        type: Schema.const('color').required(),
        color: Schema.string().description('color').default('black')
      }),
      Schema.object({
        type: Schema.const('linearGradient').required(),
        angle: Schema.number().min(0).max(359).default(0).description('角度，单位 deg'),
        colorStop: Schema.array(Schema.tuple([
          Schema.number().min(0).max(1).step(0.01).default(0).role('slider').description('offset'),
          Schema.string().description('color')
        ]).description('[偏移量,颜色]')).description('是时候学习了 [CanvasGradient.addColorStop](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasGradient/addColorStop)')
      }),
      Schema.object({
        type: Schema.const('pattern').required(),
        pattern: Schema.string().description('还没做好')
      }),
      Schema.object({})
    ])
  ]).description('前景填充'),
})

export const using = []

export function apply(ctx: Context, config: Config) {
  ctx.before('send', (session) => {
    const content = h.unescape(session.content)
    let contentMapper = [content]
    if (content.includes('\n')) {
      contentMapper = content.split('\n')
    }
    if (h('', session.elements).toString(true).length > config.maxLength || contentMapper.length > config.maxLineCount) {
      const can = new Canvas()
      const ctx = can.getContext('2d')
      const run = () => {
        ctx.textAlign = "left"
        ctx.textBaseline = 'top'
        ctx.textWrap = true
        ctx.font = `${config.fontSize}px${config.lineHeight ? `/${config.lineHeight}px` : ''} ${config.font}`
      }
      run()
      const { width, lines } = ctx.measureText(content, config.imageMaxWidth.auto ? undefined : config.imageMaxWidth.maxWidth)

      ctx.save()
      can.width = Math.max(width, config.imageMinWidth) + config.padding.left + config.padding.right
      can.height = lines[lines.length - 1].baseline + config.lineHeight / 2 + config.padding.top + config.padding.bottom
      ctx.restore()

      run()
      //todo 添加其他两种类型
      //背景色
      ctx.save()
      if (config.background.type == 'color') {
        ctx.fillStyle = config.background.color
      } else if (config.background.type == 'linearGradient') {
        const cg = ctx.createLinearGradient(...calcGradual(config.background.angle, can))
        config.background.colorStop.forEach(e => cg.addColorStop(...e))
        ctx.fillStyle = cg
      } else {
        ctx.fillStyle = 'white'
      }
      ctx.fillRect(0, 0, can.width, can.height)
      ctx.restore()

      //前景色
      if (config.foreground.type == 'color') {
        ctx.fillStyle = config.foreground.color
      } else if (config.foreground.type == 'linearGradient') {
        const cg = ctx.createLinearGradient(...calcGradual(config.foreground.angle, can))
        config.foreground.colorStop.forEach(e => cg.addColorStop(...e))
        ctx.fillStyle = cg
      } else {
        ctx.fillStyle = 'black'
      }

      ctx.fillText(content, config.padding.left, config.padding.top, config.imageMaxWidth.auto ? undefined : config.imageMaxWidth.maxWidth)
      session.elements = [h.image(can.toBufferSync('png'), 'image/png')]
    }
  })
}


function calcGradual(angle: number, canvas: Canvas): [number, number, number, number] {
  angle = angle * Math.PI / 180
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2

  const length = Math.sqrt(canvas.width ** 2 + canvas.height ** 2)

  const x0 = centerX - length / 2 * Math.cos(angle)
  const y0 = centerY - length / 2 * Math.sin(angle)

  const x1 = centerX + length / 2 * Math.cos(angle)
  const y1 = centerY + length / 2 * Math.sin(angle)
  return [x0, y0, x1, y1]
}
