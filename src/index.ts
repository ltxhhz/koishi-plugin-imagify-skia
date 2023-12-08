import { Context, Logger, Schema, h } from 'koishi'
import type { Canvas } from '@ltxhhz/koishi-plugin-skia-canvas'
import { defaultsDeep } from 'lodash'
import assert from 'assert'

export const name = 'imagify-skia'

type TupleOf<T, N extends number, R extends unknown[] = []> = R['length'] extends N ? R : TupleOf<T, N, [T, ...R]>

type Ground =
  | {
      type: 'color'
      color?: string
    }
  | {
      type: 'linearGradient'
      angle: number
      colorStop: [number, string][]
    }
  | {
      type: 'radialGradient'
      round0: [string, string]
      r0: string
      round1: [string, string]
      r1: string
      colorStop: [number, string][]
    }
  | {
      type: 'pattern'
      pattern: any
    }
  | {
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
  maxLineCount?: number
  maxLength?: number
  // background: string
  // blur: number,
  imageMinWidth?: number
  imageMaxWidth?: {
    auto?: boolean
    maxWidth?: number
  }
  lineHeight?: number
  fontSize?: number
  font?: string
  padding?: Record<'left' | 'right' | 'top' | 'bottom', number>
  background?: Ground & {
    baseColor?: string
  }
  foreground?: Ground & {
    baseColor?: string
  }
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    maxLineCount: Schema.number().min(1).default(20).description('当文本行数超过该值时转为图片'),
    maxLength: Schema.number().min(1).default(600).description('当返回的文本字数超过该值时转为图片'),
    imageMinWidth: Schema.number().min(100).default(200).description('图片最小宽度，单位 px'),
    imageMaxWidth: Schema.intersect([
      Schema.object({
        auto: Schema.boolean().default(true).description('是否自动识别文本宽度')
      }),
      Schema.union([
        Schema.object({
          auto: Schema.const(false).required(),
          maxWidth: Schema.number().min(300).default(400).description('图片最大宽度，单位 px')
        }),
        Schema.object({}) //配置联动，因为上面的属性不是必须的，所以可以省略
      ])
    ]),
    lineHeight: Schema.number().min(0).default(0).description('文字行高，为0则不设置'),
    padding: Schema.object({
      left: Schema.number().min(0).default(20).description('内边距'),
      right: Schema.number().min(0).default(20).description('内边距'),
      top: Schema.number().min(0).default(20).description('内边距'),
      bottom: Schema.number().min(0).default(20).description('内边距')
    }).description('边距')
  }),
  Schema.object({
    fontSize: Schema.number().min(0).default(20).description('文字大小'),
    font: Schema.string().default('Microsoft YaHei, sans-serif').description('字体，类似 css 语法')
  }).description('字体配置'),
  Schema.object({
    ps: Schema.any().description('以下所有的填充方案已经配置了**默认值**，只需要切换即可体验，如果不熟悉css或者不会配置又想用好看的样式，建议直接问大佬要配置。')
  })
    .disabled()
    .description('填充说明'),
  Schema.object({
    background: Schema.intersect([
      Schema.object({
        baseColor: Schema.string().default('white').description('基础颜色，和 `color` 类型一样，用来保证其他类型的填充不能覆盖部分不至于透明，为空则不填充'),
        type: Schema.union<'color' | 'linearGradient' | 'radialGradient' | 'pattern'>(['color', 'linearGradient', 'radialGradient' /* , 'pattern' */]).description('是时候学习了： [fillStyle](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasRenderingContext2D/fillStyle)')
      }),
      Schema.union([
        Schema.object({
          type: Schema.const('color').required(),
          color: Schema.string().description('颜色').default('white')
        }),
        Schema.object({
          type: Schema.const('linearGradient').required(),
          angle: Schema.number().min(0).max(359).default(0).description('角度，单位 deg，0为正上方，与 css 相同'),
          colorStop: Schema.array(Schema.tuple([Schema.number().min(0).max(1).step(0.01).default(0).role('slider').description('offset'), Schema.string().description('color')]).description('[偏移量,颜色]'))
            .default([
              [0, '#5efce8'],
              [1, '#736efe']
            ])
            .description('是时候学习了 [CanvasGradient.addColorStop](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasGradient/addColorStop)')
        }),
        Schema.object({
          type: Schema.const('radialGradient').required(),
          round0: Schema.tuple([Schema.string().default('0'), Schema.string().default('0')])
            .required()
            .description('圆1坐标[x,y]，当前值和以下值，填入数字则为像素(px)单位，填入 `数字+字母`则为 `数字*字母所代表的值`，`w`为图片宽，`h`为图片高，`d`为图片对角线长'),
          r0: Schema.string().default('0.2w').description('圆0半径'),
          round1: Schema.tuple([Schema.string().default('1w'), Schema.string().default('1h')]).description('圆1坐标[x,y]'),
          r1: Schema.string().default('0.5w').description('圆1半径'),
          colorStop: Schema.array(Schema.tuple([Schema.number().min(0).max(1).step(0.01).default(0).role('slider').description('offset'), Schema.string().description('color')]).description('[偏移量,颜色]'))
            .default([
              [0, '#5efce8'],
              [1, '#736efe']
            ])
            .description('是时候学习了 [CanvasGradient.addColorStop](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasGradient/addColorStop)')
        }),
        Schema.object({
          type: Schema.const('pattern').required(),
          pattern: Schema.string().description('下次丕定')
        }),
        Schema.object({})
      ])
    ])
  }).description('背景填充'),
  Schema.object({
    foreground: Schema.intersect([
      Schema.object({
        baseColor: Schema.string().default('black').description('基础颜色，和 `color` 类型一样，用来保证其他类型的填充不能覆盖部分不至于透明，为空则不填充'),
        type: Schema.union<'color' | 'linearGradient' | 'radialGradient' | 'pattern'>(['color', 'linearGradient', 'radialGradient' /* , 'pattern' */]).description('是时候学习了： [fillStyle](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasRenderingContext2D/fillStyle)')
      }),
      Schema.union([
        Schema.object({
          type: Schema.const('color').required(),
          color: Schema.string().description('color').default('black')
        }),
        Schema.object({
          type: Schema.const('linearGradient').required(),
          angle: Schema.number().min(0).max(359).default(0).description('角度，单位 deg'),
          colorStop: Schema.array(Schema.tuple([Schema.number().min(0).max(1).step(0.01).default(0).role('slider').description('offset'), Schema.string().description('color')]).description('[偏移量,颜色]'))
            .default([
              [0, 'red'],
              [0.5, 'green'],
              [1, 'blue']
            ])
            .description('是时候学习了 [CanvasGradient.addColorStop](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasGradient/addColorStop)')
        }),
        Schema.object({
          type: Schema.const('radialGradient').required(),
          round0: Schema.tuple([Schema.string().default('0'), Schema.string().default('0')])
            .required()
            .description('圆1坐标[x,y]，当前值和以下值，填入数字则为像素(px)单位，填入 `数字+字母`则为 `数字*字母所代表的值`，`w`为图片宽，`h`为图片高，`d`为图片对角线长'),
          r0: Schema.string().default('0.2w').description('圆0半径'),
          round1: Schema.tuple([Schema.string().default('1w'), Schema.string().default('1h')]).description('圆1坐标[x,y]'),
          r1: Schema.string().default('0.5w').description('圆1半径'),
          colorStop: Schema.array(Schema.tuple([Schema.number().min(0).max(1).step(0.01).default(0).role('slider').description('offset'), Schema.string().description('color')]).description('[偏移量,颜色]'))
            .default([
              [0, 'red'],
              [0.5, 'green'],
              [1, 'blue']
            ])
            .description('是时候学习了 [CanvasGradient.addColorStop](https://developer.mozilla.org/zh-CN/docs/Web/API/CanvasGradient/addColorStop)')
        }),
        Schema.object({
          type: Schema.const('pattern').required(),
          pattern: Schema.string().description('下次丕定')
        }),
        Schema.object({})
      ])
    ])
  }).description('前景填充'),
  Schema.object({}).description('') //防止类型报错
])

export const inject = ['skia']

let logger: Logger

export function apply(ctx: Context, cfg: Config) {
  logger = ctx.logger('imagify-skia')
  const config = checkConfig(cfg)
  const { Canvas } = ctx.skia
  ctx.before('send', session => {
    const content = h.unescape(session.content)
    let contentMapper = [content]
    if (content.includes('\n')) {
      contentMapper = content.split('\n')
    }
    if (h('', session.elements).toString(true).length > config.maxLength || contentMapper.length > config.maxLineCount) {
      const can = new Canvas()
      const ctx = can.getContext('2d')
      const run = () => {
        ctx.textAlign = 'left'
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
      //todo pattern 下次丕定
      //背景色
      ctx.save()
      logger.debug(config)
      if (config.background.baseColor) {
        ctx.fillStyle = config.background.baseColor
        ctx.fillRect(0, 0, can.width, can.height)
      }
      if (config.background.type == 'color') {
        ctx.fillStyle = config.background.color
      } else if (config.background.type == 'linearGradient') {
        const lg = ctx.createLinearGradient(...calcLinearGradual(config.background.angle, can))
        config.background.colorStop.forEach(e => lg.addColorStop(...e))
        ctx.fillStyle = lg
      } else if (config.background.type == 'radialGradient') {
        const rg = ctx.createRadialGradient(...calcRadialGradient(config.background, can))
        config.background.colorStop.forEach(e => rg.addColorStop(...e))
        ctx.fillStyle = rg
      } else {
        ctx.fillStyle = 'white'
      }
      ctx.fillRect(0, 0, can.width, can.height)
      ctx.restore()
      if (config.foreground.baseColor) {
        ctx.fillStyle = config.foreground.baseColor
        ctx.fillText(content, config.padding.left, config.padding.top, config.imageMaxWidth.auto ? undefined : config.imageMaxWidth.maxWidth)
      }
      //前景色
      if (config.foreground.type == 'color') {
        ctx.fillStyle = config.foreground.color
      } else if (config.foreground.type == 'linearGradient') {
        const lg = ctx.createLinearGradient(...calcLinearGradual(config.foreground.angle, can))
        config.foreground.colorStop.forEach(e => lg.addColorStop(...e))
        ctx.fillStyle = lg
      } else if (config.foreground.type == 'radialGradient') {
        const rg = ctx.createRadialGradient(...calcRadialGradient(config.foreground, can))
        config.foreground.colorStop.forEach(e => rg.addColorStop(...e))
        ctx.fillStyle = rg
      } else {
        ctx.fillStyle = 'black'
      }

      ctx.fillText(content, config.padding.left, config.padding.top, config.imageMaxWidth.auto ? undefined : config.imageMaxWidth.maxWidth)
      session.elements = [h.image(can.toBufferSync('png'), 'image/png')]
    }
  })
}

/**
 * 计算canvas渐变起始坐标 
 * @see [来源](https://blog.csdn.net/JJHuiQ/article/details/118308025)
 */
function calcLinearGradual(angle: number, canvas: Canvas): TupleOf<number, 4> {
  const { height, width } = canvas
  if (angle >= 360) angle = angle - 360
  else if (angle < 0) angle = angle + 360
  angle = Math.round(angle)

  // 当渐变轴垂直于矩形水平边上的两种结果
  if (angle === 0) {
    return [Math.round(width / 2), height, Math.round(width / 2), 0]
  }
  if (angle === 180) {
    return [Math.round(width / 2), 0, Math.round(width / 2), height]
  }

  // 当渐变轴垂直于矩形垂直边上的两种结果
  if (angle === 90) {
    return [0, Math.round(height / 2), width, Math.round(height / 2)]
  }
  if (angle === 270) {
    return [width, Math.round(height / 2), 0, Math.round(height / 2)]
  }

  // 从矩形左下角至右上角的对角线的角度
  const alpha = Math.round((Math.asin(width / Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2))) * 180) / Math.PI)

  // 当渐变轴分别于矩形的两条对角线重合情况下的四种结果
  if (angle === alpha) {
    return [0, height, width, 0]
  }
  if (angle === 180 - alpha) {
    return [0, 0, width, height]
  }
  if (angle === 180 + alpha) {
    return [width, 0, 0, height]
  }
  if (angle === 360 - alpha) {
    return [width, height, 0, 0]
  }

  // 以矩形的中点为坐标原点，向上为Y轴正方向，向右为X轴正方向建立直角坐标系
  let x0 = 0,
    y0 = 0,
    x1 = 0,
    y1 = 0

  // 当渐变轴与矩形的交点落在水平线上
  if (
    angle < alpha || // 处于第一象限
    (angle > 180 - alpha && angle < 180) || // 处于第二象限
    (angle > 180 && angle < 180 + alpha) || // 处于第三象限
    angle > 360 - alpha // 处于第四象限
  ) {
    // 将角度乘以（PI/180）即可转换为弧度
    const radian = (angle * Math.PI) / 180
    // 当在第一或第四象限，y是height / 2，否则y是-height / 2
    const y = angle < alpha || angle > 360 - alpha ? height / 2 : -height / 2
    const x = Math.tan(radian) * y
    // 当在第一或第二象限，l是width / 2 - x，否则l是-width / 2 - x
    const l = angle < alpha || (angle > 180 - alpha && angle < 180) ? width / 2 - x : -width / 2 - x
    const n = Math.pow(Math.sin(radian), 2) * l
    x1 = x + n
    y1 = y + n / Math.tan(radian)
    x0 = -x1
    y0 = -y1
  }

  // 当渐变轴与矩形的交点落在垂直线上
  if (
    (angle > alpha && angle < 90) || // 处于第一象限
    (angle > 90 && angle < 180 - alpha) || // 处于第二象限
    (angle > 180 + alpha && angle < 270) || // 处于第三象限
    (angle > 270 && angle < 360 - alpha) // 处于第四象限
  ) {
    // 将角度乘以（PI/180）即可转换为弧度
    const radian = ((90 - angle) * Math.PI) / 180
    // 当在第一或第二象限，x是width / 2，否则x是-width / 2
    const x = (angle > alpha && angle < 90) || (angle > 90 && angle < 180 - alpha) ? width / 2 : -width / 2
    const y = Math.tan(radian) * x
    // 当在第一或第四象限，l是height / 2 - y，否则l是-height / 2 - y
    const l = (angle > alpha && angle < 90) || (angle > 270 && angle < 360 - alpha) ? height / 2 - y : -height / 2 - y
    const n = Math.pow(Math.sin(radian), 2) * l
    x1 = x + n / Math.tan(radian)
    y1 = y + n
    x0 = -x1
    y0 = -y1
  }

  // 坐标系更改为canvas标准，Y轴向下为正方向
  x0 = Math.round(x0 + width / 2)
  y0 = Math.round(height / 2 - y0)
  x1 = Math.round(x1 + width / 2)
  y1 = Math.round(height / 2 - y1)

  return [x0, y0, x1, y1]
}

function calcRadialGradient(cfg: { type: 'radialGradient'; round0: [string, string]; r0: string; round1: [string, string]; r1: string; colorStop: [number, string][] }, canvas: Canvas): TupleOf<number, 6> {
  const reg = /^([\d\.]+)([a-z])$/
  //@ts-ignore
  return [...cfg.round0, cfg.r0, ...cfg.round1, cfg.r1].map(e => {
    let res = e.toLowerCase().match(reg)
    if (res) {
      switch (res[2]) {
        case 'w':
          return Number(res[1]) * canvas.width
        case 'h':
          return Number(res[1]) * canvas.height
        case 'd':
          return Number(res[1]) * Math.sqrt(canvas.width ** 2 + canvas.height ** 2)
        default:
          break
      }
    }
    return Number(e)
  })
}

function checkConfig(cfg: Config): Required<Config> {
  const config: Required<Config> = defaultsDeep(cfg, {
    maxLineCount: 20,
    maxLength: 600,
    imageMinWidth: 200,
    imageMaxWidth: {
      auto: true,
      maxWidth: 400
    },
    lineHeight: 0,
    fontSize: 20,
    font: 'Microsoft YaHei, sans-serif',
    padding: {
      left: 20,
      right: 20,
      top: 20,
      bottom: 20
    },
    background: {
      baseColor: 'white',
      type: ''
    },
    foreground: {
      baseColor: 'white',
      type: ''
    }
  } as Config)
  switch (config.background.type) {
    case 'color':
      // assert(config.background.color, '未提供 background.color')
      config.background.color ||= 'white'
      break
    case 'linearGradient':
      // assert(config.background.angle || config.background.angle == 0, '未提供 background.angle')
      config.background.angle ??= 0
      if (!config.background.colorStop.length) {
        config.background.colorStop.push([0, '#5efce8'], [1, '#736efe'])
      }
      assert(config.background.colorStop.length > 1, '未提供 background.colorStop 或不正确')
      break
    case 'radialGradient':
      // assert(config.background.r1, '未提供 background.r1')
      // assert(config.background.r2, '未提供 background.r2')
      if (!config.background.round0?.length) {
        config.background.round0 = ['0', '0']
      }
      assert(config.background.round0.length == 2, '未提供 background.round0 或不正确')
      if (!config.background.round1?.length) {
        config.background.round1 = ['1w', '1h']
      }
      assert(config.background.round1.length == 2, '未提供 background.round1 或不正确')
      config.background.r0 ||= '0.2w'
      config.background.r1 ||= '0.5w'
      if (!config.background.colorStop?.length) {
        config.background.colorStop = [
          [0, '#5efce8'],
          [1, '#736efe']
        ]
      }
      assert(config.background.colorStop.length > 1, '未提供 background.colorStop 或不正确')

    case 'pattern':
    default:
      break
  }
  switch (config.foreground.type) {
    case 'color':
      // assert(config.foreground.color, '未提供 foreground.color')
      config.foreground.color ||= 'black'
      break
    case 'linearGradient':
      // assert(config.foreground.angle || config.foreground.angle == 0, '未提供 foreground.angle')
      config.foreground.angle ??= 0
      if (!config.foreground.colorStop.length) {
        config.foreground.colorStop.push([0, 'red'], [0.5, 'green'], [1, 'blue'])
      }
      assert(config.foreground.colorStop.length > 1, '未提供 foreground.colorStop 或不正确')
      break
    case 'radialGradient':
      // assert(config.foreground.r1, '未提供 foreground.r1')
      // assert(config.foreground.r2, '未提供 foreground.r2')
      if (!config.foreground.round0?.length) {
        config.foreground.round0 = ['0', '0']
      }
      assert(config.foreground.round0.length == 2, '未提供 foreground.round0 或不正确')
      if (!config.foreground.round1?.length) {
        config.foreground.round1 = ['1w', '1h']
      }
      assert(config.foreground.round1.length == 2, '未提供 foreground.round1 或不正确')
      config.foreground.r0 ||= '0.2w'
      config.foreground.r1 ||= '0.5w'
      if (!config.foreground.colorStop?.length) {
        config.foreground.colorStop = [
          [0, 'red'],
          [0.5, 'green'],
          [1, 'blue']
        ]
      }
      assert(config.foreground.colorStop.length > 1, '未提供 foreground.colorStop 或不正确')

    case 'pattern':
    default:
      break
  }
  return config
}

