"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { usePrefersReducedMotion } from "./hooks";

/*
 * Liquid cursor over cinematic art, after Ideogram's oil-slick hero transition. The SVG art is
 * rasterised once into a WebGL texture. The pointer paints a trail into a small low-res field that
 * drifts along a noise flow and fades; the composite pass warps the art inside the trail and adds
 * thin-film rainbow rims. Without WebGL, or with reduced motion, the plain SVG stays.
 */

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const NOISE = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}`;

/** Trail field: fade, drift along a noise flow, then stamp the latest pointer segment. */
const TRAIL = `${NOISE}
uniform sampler2D u_prev;
uniform vec2 u_a;
uniform vec2 u_b;
uniform float u_strength;
uniform float u_radius;
uniform float u_aspect;
uniform float u_time;
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec2 flow = vec2(noise(v_uv * 3.0 + u_time * 0.2), noise(v_uv * 3.0 + 17.0 - u_time * 0.2)) - 0.5;
  float v = texture2D(u_prev, v_uv - flow * 0.012).r;
  v = max(v * 0.986 - 0.0015, 0.0);
  vec2 sc = vec2(u_aspect, 1.0);
  float r = u_radius * (0.5 + 0.9 * noise(v_uv * 6.0 + u_time * 0.7));
  v += smoothstep(r, 0.0, segDist(v_uv * sc, u_a * sc, u_b * sc)) * u_strength;
  gl_FragColor = vec4(min(v, 1.0), 0.0, 0.0, 1.0);
}`;

/** Shared by both passes: the trail's oily mask, thin-film colour, rims and dark cores. */
const SLICK = `${NOISE}
uniform sampler2D u_trail;
uniform float u_aspect;
uniform float u_time;
struct Slick {
  vec2 p;
  float m;
  float rim;
  float core;
  vec3 film;
};
Slick slick(vec2 uv) {
  Slick s;
  float t = texture2D(u_trail, uv).r;
  s.p = uv * vec2(u_aspect, 1.0);
  float n = fbm(s.p * 3.0 + u_time * 0.08);
  // High-frequency noise breaks the trail into oily islands instead of one smooth tube.
  float grain = fbm(s.p * 9.0 - u_time * 0.12);
  s.m = smoothstep(0.12, 0.62, t * (0.25 + n * 0.8 + grain * 0.9));
  // Thin-film colour: hue cycles with local "thickness", so it shifts along the rims.
  float phase = grain * 4.0 + n * 2.0 + t * 3.0 + u_time * 0.1;
  s.film = 0.5 + 0.5 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.67)));
  s.rim = smoothstep(0.02, 0.22, s.m) * (1.0 - smoothstep(0.22, 0.6, s.m));
  s.core = smoothstep(0.45, 0.95, s.m);
  return s;
}`;

/** Behind the content: warp the art inside the trail, split channels, and paint the slick. */
const COMPOSITE = `${SLICK}
uniform sampler2D u_scene;
void main() {
  Slick s = slick(v_uv);
  vec2 warp = (vec2(fbm(s.p * 4.0 + 3.1 + u_time * 0.1), fbm(s.p * 4.0 - 5.7 - u_time * 0.1)) - 0.5) * 0.15 * s.m;
  vec3 scene = vec3(
    texture2D(u_scene, v_uv + warp).r,
    texture2D(u_scene, v_uv + warp * 1.3).g,
    texture2D(u_scene, v_uv + warp * 1.6).b
  );
  vec3 col = mix(scene, scene * 0.35 + s.film * 0.75, s.rim);
  col = mix(col, scene * 0.4 + s.film * vec3(0.1, 0.16, 0.36), s.core * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Above the content: the slick alone, premultiplied, transparent wherever the trail is empty. */
const SHEEN = `${SLICK}
void main() {
  Slick s = slick(v_uv);
  float a = s.rim * 0.8 + s.core * 0.45;
  gl_FragColor = vec4(s.film * s.rim * 0.8 + vec3(0.03, 0.03, 0.08) * s.core * 0.45, a);
}`;

/** Pointer over these never stamps new liquid, so it cannot swallow what you are about to click. */
const CONTROLS = "a, button, input, select, textarea, label, summary, [role='button']";

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer };

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

function program(gl: WebGLRenderingContext, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "a_pos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(p, name));
    return uniforms.get(name)!;
  };
  return { p, u };
}

function texture(gl: WebGLRenderingContext) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function target(gl: WebGLRenderingContext, w: number, h: number): Target {
  const tex = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo };
}

/**
 * Rasterise the art at the canvas's pixel size. A photo is cover-cropped the way CSS shows it
 * (object-fit: cover, honouring its object-position); an SVG crops itself via preserveAspectRatio.
 */
async function rasterise(host: HTMLElement, w: number, h: number): Promise<TexImageSource> {
  const photo = host.querySelector("img");
  if (photo) {
    await photo.decode();
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const scale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
    const dw = photo.naturalWidth * scale;
    const dh = photo.naturalHeight * scale;
    const [px, py] = getComputedStyle(photo)
      .objectPosition.split(" ")
      .map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : 0.5));
    out.getContext("2d")!.drawImage(photo, (w - dw) * px, (h - dh) * py, dw, dh);
    return out;
  }
  const svg = host.querySelector("svg")!;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("class");
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await img.decode();
  return img;
}

/**
 * Starts the effect; returns a cleanup function. Throws if WebGL is unavailable. With `overlay`,
 * each frame also renders the sheen pass and copies it onto that 2D canvas, which sits above the
 * page content; one WebGL context drives both layers, so they stay in step.
 */
function startLiquid(host: HTMLElement, canvas: HTMLCanvasElement, overlay?: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { antialias: false });
  const sheenCtx = overlay?.getContext("2d") ?? null;
  if (!host.querySelector("img, svg") || !gl) throw new Error("webgl unavailable");

  const trailProg = program(gl, TRAIL);
  const compProg = program(gl, COMPOSITE);
  const sheenProg = overlay ? program(gl, SHEEN) : null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = texture(gl);
  let trails: [Target, Target] | null = null;
  let tw = 0;
  let th = 0;
  let ready = false;
  let disposed = false;
  let raf = 0;
  let inView = true;
  let idleFrames = 0;
  const t0 = performance.now();

  // Pointer segment since the last frame, in uv space (y up).
  let last: [number, number] | null = null;
  let cur: [number, number] | null = null;
  let speed = 0;

  const resize = async () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    const img = await rasterise(host, w, h);
    if (disposed) return;
    canvas.width = w;
    canvas.height = h;
    if (overlay) {
      overlay.width = w;
      overlay.height = h;
    }
    gl.bindTexture(gl.TEXTURE_2D, scene);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    tw = Math.max(1, Math.round(w / 4));
    th = Math.max(1, Math.round(h / 4));
    trails = [target(gl, tw, th), target(gl, tw, th)];
    ready = true;
    canvas.dataset.ready = "";
    kick();
  };

  const frame = () => {
    raf = 0;
    if (!ready || !trails || disposed) return;
    const time = ((performance.now() - t0) / 1000) % 1000;
    const aspect = canvas.width / canvas.height;
    const moving = cur !== null;
    const a = last ?? cur ?? [0, 0];
    const b = cur ?? a;

    gl.useProgram(trailProg.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trails[1].fbo);
    gl.viewport(0, 0, tw, th);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trails[0].tex);
    gl.uniform1i(trailProg.u("u_prev"), 0);
    gl.uniform2f(trailProg.u("u_a"), a[0], a[1]);
    gl.uniform2f(trailProg.u("u_b"), b[0], b[1]);
    gl.uniform1f(trailProg.u("u_strength"), moving ? Math.min(1, 0.3 + speed * 8) : 0);
    gl.uniform1f(trailProg.u("u_radius"), 0.085);
    gl.uniform1f(trailProg.u("u_aspect"), aspect);
    gl.uniform1f(trailProg.u("u_time"), time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    trails = [trails[1], trails[0]];

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Sheen first: draw it into the WebGL canvas, copy it to the overlay, then draw the scene over it.
    if (sheenProg && sheenCtx && overlay) {
      gl.useProgram(sheenProg.p);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trails[0].tex);
      gl.uniform1i(sheenProg.u("u_trail"), 0);
      gl.uniform1f(sheenProg.u("u_aspect"), aspect);
      gl.uniform1f(sheenProg.u("u_time"), time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      sheenCtx.clearRect(0, 0, overlay.width, overlay.height);
      sheenCtx.drawImage(canvas, 0, 0);
    }

    gl.useProgram(compProg.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene);
    gl.uniform1i(compProg.u("u_scene"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, trails[0].tex);
    gl.uniform1i(compProg.u("u_trail"), 1);
    gl.uniform1f(compProg.u("u_aspect"), aspect);
    gl.uniform1f(compProg.u("u_time"), time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    last = cur ?? null;
    cur = null;
    speed = 0;
    // The trail fully fades within ~4 s; after that the frame is the plain art, so stop drawing.
    idleFrames = moving ? 0 : idleFrames + 1;
    if (idleFrames < 260 && inView) raf = requestAnimationFrame(frame);
    else last = null;
  };

  const kick = () => {
    if (!raf && ready && inView) raf = requestAnimationFrame(frame);
  };

  const onMove = (e: PointerEvent) => {
    if (!inView) return;
    if (e.target instanceof Element && e.target.closest(CONTROLS)) {
      last = null;
      return;
    }
    const r = host.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      last = null;
      return;
    }
    const prev = cur ?? last;
    if (prev) speed += Math.hypot(x - prev[0], y - prev[1]);
    cur = [x, y];
    if (!last) last = cur;
    idleFrames = 0;
    kick();
  };

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void resize().catch(() => undefined), 150);
  });
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) kick();
  });
  io.observe(host);
  window.addEventListener("pointermove", onMove, { passive: true });
  canvas.addEventListener("webglcontextlost", () => {
    ready = false;
    delete canvas.dataset.ready;
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(resizeTimer);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener("pointermove", onMove);
    delete canvas.dataset.ready;
  };
}

type LiquidArtProps = {
  children: ReactNode;
  className?: string;
  /**
   * When set, the oil-slick sheen is also painted on a second canvas with these classes, so it
   * can sit above the page content. Give it the same box (and animation) as `className`.
   */
  overlayClassName?: string;
};

/** Wraps server-rendered art (SVG or a photo) and lays the liquid cursor canvas over it. */
export function LiquidArt({ children, className, overlayClassName }: LiquidArtProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced || !hostRef.current || !canvasRef.current) return;
    try {
      return startLiquid(hostRef.current, canvasRef.current, overlayRef.current ?? undefined);
    } catch {
      // No WebGL: the plain art stays visible.
    }
  }, [reduced]);

  return (
    <>
      <div ref={hostRef} className={cn("overflow-hidden", className)}>
        {children}
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0 transition-opacity duration-300 data-[ready]:opacity-100"
        />
      </div>
      {overlayClassName && <canvas ref={overlayRef} aria-hidden="true" className={cn("pointer-events-none", overlayClassName)} />}
    </>
  );
}
