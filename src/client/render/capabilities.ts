import type { WebGLRenderer } from 'three';

export interface RenderCapabilities {
  floatTargets: boolean;
  multipleTargets: boolean;
  timerQueries: boolean;
  maxTextureSize: number;
}
export function renderCapabilities(renderer: WebGLRenderer): RenderCapabilities {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  return {
    floatTargets: renderer.extensions.has('EXT_color_buffer_float'),
    multipleTargets: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) >= 2,
    timerQueries: renderer.extensions.has('EXT_disjoint_timer_query_webgl2'),
    maxTextureSize: renderer.capabilities.maxTextureSize,
  };
}

/** Availability polling never waits for the GPU or calls finish/readPixels. */
export class GpuTimer {
  private extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active?: WebGLQuery;
  private samples: number[] = [];
  milliseconds: number | null = null;
  p95Milliseconds: number | null = null;
  constructor(private gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  restore(): void {
    this.clear();
    this.extension = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  begin(enabled: boolean): void {
    if (!enabled) {
      this.clear();
      return;
    }
    const { gl, extension } = this;
    if (!extension) return;
    if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
      this.clear();
      return;
    }
    while (
      this.pending.length &&
      gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)
    ) {
      const query = this.pending.shift()!;
      const duration = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      if (duration > 0 && duration < 10000) {
        this.samples.push(duration);
        if (this.samples.length > 30) this.samples.shift();
        const sorted = [...this.samples].sort((a, b) => a - b);
        this.milliseconds = Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
        this.p95Milliseconds =
          Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 100) /
          100;
      }
    }
    if (this.pending.length >= 4 || this.active) return;
    this.active = gl.createQuery() ?? undefined;
    if (this.active) gl.beginQuery(extension.TIME_ELAPSED_EXT, this.active);
  }
  end(): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = undefined;
  }
  clear(): void {
    this.end();
    this.pending.forEach((query) => this.gl.deleteQuery(query));
    this.pending = [];
    this.samples = [];
    this.milliseconds = null;
    this.p95Milliseconds = null;
  }
}
