// whether this window draws without a gpu (chromium's software renderer: no gpu, a blocked one,
// or mesa's llvmpipe): canvases are then drawn by the cpu, pixel by pixel. asked once, with a
// throwaway webgl context (the water asks its own context the same way)

let answer: boolean | null = null;

export const softwareRendering = (): boolean => {
  if (answer !== null) return answer;
  answer = true;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      answer = /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* no webgl at all: software */
  }
  return answer;
};
