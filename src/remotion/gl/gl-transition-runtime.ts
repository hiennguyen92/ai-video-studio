/**
 * Runtime WebGL2 cho chuyển cảnh hai texture.
 *
 * Phái sinh từ `src/gl/runtime.ts` của OpenChatCut (AGPL-3.0-or-later) — xem
 * `NOTICE`. Giữ lại đúng đường vẽ chuyển cảnh; bỏ đường FX nhiều lượt, LUT 3D và
 * lớp phủ độ mờ vì dự án này làm những thứ đó bằng bộ lọc SVG ở tầng DOM.
 *
 * Hợp đồng của shader: một quad phủ kín khung, mảnh shader nhận `v_texCoord` và
 * các uniform `u_outgoing` / `u_incoming` / `u_progress`, cộng `u_resolution`,
 * `u_aspect` và phần riêng của từng kiểu. Không dính React — phần ghép vào
 * Remotion nằm ở `gl-transition-layer.tsx`.
 */

export type UniformValue = number | number[]

export interface GlTransitionRuntime {
  /** Vẽ một khung. Nguồn là thẻ `<video>`, `<img>` hay canvas đã dựng sẵn. */
  render(
    frag: string,
    outgoing: TexImageSource,
    incoming: TexImageSource,
    progress: number,
    extra?: Record<string, UniformValue>
  ): void
  dispose(): void
}

/** Shader đỉnh không làm gì ngoài đưa toạ độ texture sang mảnh — mọi thứ ở mảnh. */
const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_texCoord = a_texCoord; }`

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader thất bại')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'lỗi không rõ'
    gl.deleteShader(shader)
    throw new Error(`biên dịch shader thất bại: ${log}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, frag)
  const program = gl.createProgram()
  if (!program) throw new Error('createProgram thất bại')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'lỗi không rõ'
    gl.deleteProgram(program)
    throw new Error(`liên kết chương trình thất bại: ${log}`)
  }
  return program
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('createTexture thất bại')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return texture
}

export function createGlTransitionRuntime(canvas: HTMLCanvasElement): GlTransitionRuntime {
  // `preserveDrawingBuffer` để nội dung còn nguyên sau khi vẽ: bản xuất chụp màn
  // hình ở một nhịp khác với nhịp vẽ, và không có cờ này thì vài GPU đã trình bày
  // xong rồi xoá đệm trước lúc ảnh chụp kịp đọc.
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    alpha: true,
    preserveDrawingBuffer: true
  })
  if (!gl) throw new Error('máy không có WebGL2')

  // Quad phủ kín khung, vẽ bằng một dải tam giác. Mỗi đỉnh: [x, y, u, v].
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]),
    gl.STATIC_DRAW
  )

  const textureOut = makeTexture(gl)
  const textureIn = makeTexture(gl)
  // Biên dịch shader là việc đắt; một chuyển cảnh dùng lại đúng một chương trình
  // suốt mấy chục khung nên cache theo mã nguồn là đủ.
  const programs = new Map<string, WebGLProgram>()
  let disposed = false

  const getProgram = (frag: string): WebGLProgram => {
    const cached = programs.get(frag)
    if (cached) return cached
    const program = link(gl, frag)
    programs.set(frag, program)
    return program
  }

  const bindQuad = (program: WebGLProgram): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0)
    const texCoord = gl.getAttribLocation(program, 'a_texCoord')
    gl.enableVertexAttribArray(texCoord)
    gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8)
  }

  const upload = (texture: WebGLTexture, unit: number, source: TexImageSource): void => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // Nguồn từ DOM đi từ trên xuống, còn texture của GL đi từ dưới lên: không lật
    // thì hình ra ngược.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  const setUniform = (program: WebGLProgram, name: string, value: UniformValue): void => {
    const location = gl.getUniformLocation(program, name)
    // Shader không dùng uniform này thì thôi, không phải lỗi.
    if (!location) return
    if (typeof value === 'number') gl.uniform1f(location, value)
    else if (value.length === 2) gl.uniform2f(location, value[0], value[1])
    else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2])
    else if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3])
  }

  return {
    render(frag, outgoing, incoming, progress, extra) {
      if (disposed || gl.isContextLost()) throw new Error('mất WebGL context')
      upload(textureOut, 0, outgoing)
      upload(textureIn, 1, incoming)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      const program = getProgram(frag)
      gl.useProgram(program)
      bindQuad(program)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, textureOut)
      const slotOut = gl.getUniformLocation(program, 'u_outgoing')
      if (slotOut) gl.uniform1i(slotOut, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, textureIn)
      const slotIn = gl.getUniformLocation(program, 'u_incoming')
      if (slotIn) gl.uniform1i(slotIn, 1)

      // Kẹp đúng hai đầu 0 và 1: khung ngay trước và ngay sau chuyển cảnh là clip
      // thường, nên sai lệch ở hai mốc ấy thành một cú giật nhìn thấy được.
      setUniform(program, 'u_progress', Math.max(0, Math.min(1, progress)))
      setUniform(program, 'u_resolution', [canvas.width, canvas.height])
      setUniform(program, 'u_aspect', canvas.width / Math.max(1, canvas.height))
      for (const [name, value] of Object.entries(extra ?? {})) setUniform(program, name, value)

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const program of programs.values()) gl.deleteProgram(program)
      programs.clear()
      gl.deleteTexture(textureOut)
      gl.deleteTexture(textureIn)
      gl.deleteBuffer(quad)
      // Trả context ngay thay vì chờ thu gom rác: Chrome chỉ cho chừng 16 context
      // mỗi tiến trình, và cái thứ mười bảy làm context cũ nhất chết lặng lẽ.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
