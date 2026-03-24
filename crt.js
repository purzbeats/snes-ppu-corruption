// ============================================================
//  CRT POST-PROCESSING SHADER
//  WebGL2 post-process overlay for authentic CRT phosphor look.
//  Loads after engine.js, wraps renderFrame() automatically.
//
//  URL parameters (all optional):
//    ?crt=true             Enable CRT shader (default: off)
//    ?scanlines=0.20       Scanline darkening intensity
//    ?phosphor=0.15        RGB aperture grille intensity
//    ?barrel=0.04          Barrel distortion amount
//    ?bloom=0.30           Bloom/glow intensity
//    ?bloomRadius=1.5      Bloom sample radius
//    ?chromatic=0.6        Chromatic aberration px shift
//    ?vignette=0.35        Corner darkening
//    ?noise=0.04           Film grain intensity
//    ?scene=5              Start on specific scene index
//    ?glitch=3             Lock to specific glitch mode (0=auto)
//    ?ghost=true           Enable ghost frame
//    ?autoAdvance=false    Disable auto scene advance
// ============================================================

var crtEnabled = false; // opt-in by default

var crtSettings = {
  scanlineIntensity:   0.20,
  phosphorIntensity:   0.15,
  barrelDistortion:    0.04,
  bloomIntensity:      0.30,
  bloomRadius:         1.5,
  chromaticAberration: 0.6,
  vignetteIntensity:   0.35,
  noiseIntensity:      0.04,
};

// --- Parse URL parameters ---
(function parseURLParams() {
  const p = new URLSearchParams(window.location.search);

  // CRT master toggle
  if (p.has("crt")) crtEnabled = p.get("crt") !== "false" && p.get("crt") !== "0";

  // CRT shader settings
  if (p.has("scanlines"))   crtSettings.scanlineIntensity   = parseFloat(p.get("scanlines"));
  if (p.has("phosphor"))    crtSettings.phosphorIntensity   = parseFloat(p.get("phosphor"));
  if (p.has("barrel"))      crtSettings.barrelDistortion    = parseFloat(p.get("barrel"));
  if (p.has("bloom"))       crtSettings.bloomIntensity      = parseFloat(p.get("bloom"));
  if (p.has("bloomRadius")) crtSettings.bloomRadius         = parseFloat(p.get("bloomRadius"));
  if (p.has("chromatic"))   crtSettings.chromaticAberration = parseFloat(p.get("chromatic"));
  if (p.has("vignette"))    crtSettings.vignetteIntensity   = parseFloat(p.get("vignette"));
  if (p.has("noise"))       crtSettings.noiseIntensity      = parseFloat(p.get("noise"));

  // Engine settings (applied after boot — deferred)
  window._urlScene = p.has("scene") ? parseInt(p.get("scene")) : null;
  window._urlGlitch = p.has("glitch") ? parseInt(p.get("glitch")) : null;
  window._urlGhost = p.has("ghost") ? p.get("ghost") !== "false" && p.get("ghost") !== "0" : null;
  window._urlAutoAdvance = p.has("autoAdvance") ? p.get("autoAdvance") !== "false" && p.get("autoAdvance") !== "0" : null;
})();

(function () {
  "use strict";

  // ---- WebGL2 canvas setup ----
  const srcCanvas = document.getElementById("screen");
  const glCanvas  = document.createElement("canvas");
  glCanvas.id = "crt-overlay";
  glCanvas.style.cssText = srcCanvas.style.cssText;
  // Copy fixed positioning from CSS rule
  glCanvas.style.position    = "fixed";
  glCanvas.style.top         = "50%";
  glCanvas.style.left        = "50%";
  glCanvas.style.transform   = "translate(-50%, -50%)";
  glCanvas.style.imageRendering = "pixelated";
  glCanvas.style.zIndex      = "1";
  glCanvas.style.pointerEvents = "none";
  srcCanvas.parentNode.insertBefore(glCanvas, srcCanvas.nextSibling);

  const gl = glCanvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    console.warn("CRT: WebGL2 unavailable, post-processing disabled.");
    crtEnabled = false;
    return;
  }

  // ---- Shaders ----
  const VERT_SRC = `#version 300 es
  precision highp float;
  in vec2 aPos;
  out vec2 vUV;
  void main() {
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  const FRAG_SRC = `#version 300 es
  precision highp float;

  uniform sampler2D uTex;
  uniform vec2  uResolution;    // source texture resolution (e.g. 256x224)
  uniform vec2  uOutputSize;    // CSS pixel output size
  uniform float uTime;

  // Effect intensities
  uniform float uScanline;
  uniform float uPhosphor;
  uniform float uBarrel;
  uniform float uBloom;
  uniform float uBloomRadius;
  uniform float uChroma;
  uniform float uVignette;
  uniform float uNoise;

  in  vec2 vUV;
  out vec4 fragColor;

  // --- Barrel distortion ---
  vec2 barrelDistort(vec2 uv, float amt) {
    vec2 cc = uv - 0.5;
    float r2 = dot(cc, cc);
    float f = 1.0 + r2 * amt * 8.0 + r2 * r2 * amt * 5.0;
    return cc * f + 0.5;
  }

  // --- Hash-based noise ---
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec2 uv = vUV;

    // Barrel distortion
    if (uBarrel > 0.0) {
      uv = barrelDistort(uv, uBarrel);
      // Black outside the curved screen area
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
    }

    vec2 texel = 1.0 / uResolution;

    // --- Chromatic aberration (increases toward edges) ---
    float edgeDist = length((uv - 0.5) * 2.0);
    float caShift = uChroma * texel.x * edgeDist;

    float r = texture(uTex, vec2(uv.x - caShift, uv.y)).r;
    float g = texture(uTex, uv).g;
    float b = texture(uTex, vec2(uv.x + caShift, uv.y)).b;
    vec3 color = vec3(r, g, b);

    // --- Bloom / glow (13-tap cross-shaped blur, weighted) ---
    if (uBloom > 0.0) {
      vec3 bloom = vec3(0.0);
      float totalW = 0.0;

      // 2D Gaussian-ish cross pattern: center + 4 cardinal + 4 diagonal + 4 far cardinal
      const int TAPS = 13;
      // Offsets: center, +x, -x, +y, -y, diags, far cardinal
      vec2 offsets[13];
      offsets[0]  = vec2( 0.0,  0.0);
      offsets[1]  = vec2( 1.0,  0.0);
      offsets[2]  = vec2(-1.0,  0.0);
      offsets[3]  = vec2( 0.0,  1.0);
      offsets[4]  = vec2( 0.0, -1.0);
      offsets[5]  = vec2( 1.0,  1.0);
      offsets[6]  = vec2(-1.0,  1.0);
      offsets[7]  = vec2( 1.0, -1.0);
      offsets[8]  = vec2(-1.0, -1.0);
      offsets[9]  = vec2( 2.0,  0.0);
      offsets[10] = vec2(-2.0,  0.0);
      offsets[11] = vec2( 0.0,  2.0);
      offsets[12] = vec2( 0.0, -2.0);

      float weights[13];
      weights[0]  = 1.0;
      weights[1]  = 0.75;
      weights[2]  = 0.75;
      weights[3]  = 0.75;
      weights[4]  = 0.75;
      weights[5]  = 0.5;
      weights[6]  = 0.5;
      weights[7]  = 0.5;
      weights[8]  = 0.5;
      weights[9]  = 0.25;
      weights[10] = 0.25;
      weights[11] = 0.25;
      weights[12] = 0.25;

      for (int i = 0; i < TAPS; i++) {
        vec2 sampleUV = uv + offsets[i] * texel * uBloomRadius;
        // Chromatic aberration on bloom samples too
        float br = texture(uTex, vec2(sampleUV.x - caShift, sampleUV.y)).r;
        float bg = texture(uTex, sampleUV).g;
        float bb = texture(uTex, vec2(sampleUV.x + caShift, sampleUV.y)).b;
        vec3 s = vec3(br, bg, bb);
        // Only bloom bright pixels — threshold at luminance > 0.4
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        float bloomMask = smoothstep(0.35, 0.8, lum);
        bloom += s * weights[i] * bloomMask;
        totalW += weights[i];
      }
      bloom /= totalW;
      color += bloom * uBloom;
    }

    // --- Scanline darkening ---
    if (uScanline > 0.0) {
      // Map UV to actual source pixel row
      float row = uv.y * uResolution.y;
      // Smooth sine-based scanlines that look good at all scales
      float scanMask = 1.0 - uScanline * (0.5 + 0.5 * sin(row * 3.14159265));
      // Slightly boost brightness to compensate for overall darkening
      scanMask = mix(1.0, scanMask, 1.0);
      color *= scanMask;
    }

    // --- Phosphor dot mask (aperture grille / Trinitron style) ---
    if (uPhosphor > 0.0) {
      // Use output pixel position for sub-pixel pattern
      float px = gl_FragCoord.x;
      // 3-phase RGB triad repeating every 3 output pixels
      float phase = mod(px, 3.0);
      vec3 mask;
      if (phase < 1.0) {
        mask = vec3(1.0, 1.0 - uPhosphor * 0.7, 1.0 - uPhosphor * 0.7);
      } else if (phase < 2.0) {
        mask = vec3(1.0 - uPhosphor * 0.7, 1.0, 1.0 - uPhosphor * 0.7);
      } else {
        mask = vec3(1.0 - uPhosphor * 0.7, 1.0 - uPhosphor * 0.7, 1.0);
      }
      // Brighten to compensate for mask darkening
      mask = mix(vec3(1.0), mask, 0.8);
      color *= mask;
    }

    // --- Vignette ---
    if (uVignette > 0.0) {
      vec2 vc = uv - 0.5;
      float vDist = dot(vc, vc);
      // Smooth falloff from center
      float vig = 1.0 - vDist * uVignette * 2.8;
      vig = clamp(vig * vig, 0.0, 1.0);
      color *= vig;
    }

    // --- Film grain noise ---
    if (uNoise > 0.0) {
      float n = hash13(vec3(gl_FragCoord.xy, uTime * 7.93)) * 2.0 - 1.0;
      color += vec3(n * uNoise);
    }

    // Clamp and output
    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }`;

  // ---- Compile shaders ----
  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error("CRT shader compile:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) { crtEnabled = false; return; }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("CRT program link:", gl.getProgramInfoLog(prog));
    crtEnabled = false;
    return;
  }
  gl.useProgram(prog);

  // ---- Fullscreen quad ----
  const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // ---- Texture for source canvas ----
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // ---- Uniform locations ----
  const uTex        = gl.getUniformLocation(prog, "uTex");
  const uResolution = gl.getUniformLocation(prog, "uResolution");
  const uOutputSize = gl.getUniformLocation(prog, "uOutputSize");
  const uTime       = gl.getUniformLocation(prog, "uTime");
  const uScanline   = gl.getUniformLocation(prog, "uScanline");
  const uPhosphor   = gl.getUniformLocation(prog, "uPhosphor");
  const uBarrel     = gl.getUniformLocation(prog, "uBarrel");
  const uBloom      = gl.getUniformLocation(prog, "uBloom");
  const uBloomRad   = gl.getUniformLocation(prog, "uBloomRadius");
  const uChroma     = gl.getUniformLocation(prog, "uChroma");
  const uVignette   = gl.getUniformLocation(prog, "uVignette");
  const uNoise      = gl.getUniformLocation(prog, "uNoise");

  gl.uniform1i(uTex, 0);

  // ---- Track canvas size changes ----
  let lastW = 0, lastH = 0;
  let lastStyleW = "", lastStyleH = "";

  function syncSize() {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    if (w !== lastW || h !== lastH) {
      glCanvas.width  = w;
      glCanvas.height = h;
      gl.viewport(0, 0, w, h);
      lastW = w;
      lastH = h;
    }
    // Mirror CSS sizing from source canvas
    const sw = srcCanvas.style.width;
    const sh = srcCanvas.style.height;
    if (sw !== lastStyleW || sh !== lastStyleH) {
      glCanvas.style.width  = sw;
      glCanvas.style.height = sh;
      lastStyleW = sw;
      lastStyleH = sh;
    }
  }

  // ---- CRT render pass ----
  let frameTime = 0;

  function crtRenderPass() {
    if (!crtEnabled) {
      glCanvas.style.display = "none";
      srcCanvas.style.visibility = "visible";
      return;
    }
    glCanvas.style.display = "block";
    srcCanvas.style.visibility = "hidden";

    syncSize();
    frameTime += 1.0 / 60.0;

    // Upload source canvas as texture (flip Y to match canvas 2D origin)
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

    // Set uniforms
    gl.uniform2f(uResolution, srcCanvas.width, srcCanvas.height);
    // Parse CSS px values for output size
    const outW = parseFloat(srcCanvas.style.width)  || srcCanvas.width;
    const outH = parseFloat(srcCanvas.style.height) || srcCanvas.height;
    gl.uniform2f(uOutputSize, outW, outH);
    gl.uniform1f(uTime, frameTime);

    const s = crtSettings;
    gl.uniform1f(uScanline, s.scanlineIntensity);
    gl.uniform1f(uPhosphor, s.phosphorIntensity);
    gl.uniform1f(uBarrel,   s.barrelDistortion);
    gl.uniform1f(uBloom,    s.bloomIntensity);
    gl.uniform1f(uBloomRad, s.bloomRadius);
    gl.uniform1f(uChroma,   s.chromaticAberration);
    gl.uniform1f(uVignette, s.vignetteIntensity);
    gl.uniform1f(uNoise,    s.noiseIntensity);

    // Draw
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- Wrap renderFrame ----
  const _originalRenderFrame = renderFrame;

  renderFrame = function () {
    _originalRenderFrame();
    crtRenderPass();
  };

  // ---- Handle screenshot (C key / toDataURL) ----
  // When CRT is active, screenshots should come from the GL canvas
  const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const srcCanvasRef = srcCanvas;
  const glCanvasRef  = glCanvas;
  HTMLCanvasElement.prototype.toDataURL = function () {
    if (this === srcCanvasRef && crtEnabled) {
      return _origToDataURL.apply(glCanvasRef, arguments);
    }
    return _origToDataURL.apply(this, arguments);
  };

  console.log("CRT post-processing initialized (WebGL2).");
})();

// --- Apply deferred URL engine params (after engine has booted) ---
// These run at script parse time, which is after engine.js boot.
if (typeof OFFLINE_RENDER === "undefined") {
  // Only for index.html (not streaming.html which boots manually)
  setTimeout(() => {
    if (window._urlScene != null && window._urlScene >= 0 && window._urlScene < scenes.length) {
      transitionToScene(window._urlScene);
    }
    if (window._urlGlitch != null) {
      glitchMode = window._urlGlitch;
    }
    if (window._urlGhost != null) {
      ghostEnabled = window._urlGhost;
    }
    if (window._urlAutoAdvance != null) {
      sceneAutoAdvance = window._urlAutoAdvance;
    }
  }, 100);
}
