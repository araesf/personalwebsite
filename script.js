// ============================================
// Halftone-dithered backdrop
//
// A full-screen WebGL quad. A domain-warped fbm field is sampled once per
// grid cell, and each cell is drawn as a square whose size and ink density
// track that sample — the newsprint-dot look, generated procedurally so
// there is no video or image to ship.
// ============================================

const PALETTE = {
    bg: [0.969, 0.965, 0.949],   // #f7f6f2
    ink: [0.055, 0.051, 0.043]   // near-black
};

const PITCH = 9;        // dot cell size, CSS px
const MAX_DPR = 2;

const VERT = `
attribute vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform vec2  uDrift;
uniform float uPitch;
uniform vec3  uBg;
uniform vec3  uInk;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++) {
        v += a * vnoise(p);
        p = rot * p * 2.02;
        a *= 0.5;
    }
    return v;
}

void main() {
    // Sample the field once per cell so every dot in a cell agrees.
    vec2 cell = floor(gl_FragCoord.xy / uPitch);
    vec2 center = (cell + 0.5) * uPitch;


    vec2 p = center / uRes.y;          // aspect-correct

    // uDrift travels a bounded loop, so these coordinates never grow. Letting
    // elapsed time march into them directly costs fp32 precision inside
    // hash(); the field flattens and the quantizer below then snaps the whole
    // right half to a single level — one solid slab.
    vec2 q = vec2(
        fbm(p * 1.4 + uDrift),
        fbm(p * 1.4 + uDrift.yx + vec2(5.2, 1.3))
    );
    float n = fbm(p * 1.35 + q * 1.9 + uDrift * 0.5);
    n = smoothstep(0.30, 0.74, n);

    // Quantize to discrete steps — a crisp dither, never a smooth gradient.
    float v = clamp(floor(n * 5.0) / 4.0, 0.0, 1.0);

    // The grid covers the whole page, but only the right half carries the
    // field — left of centre stays a flat, even baseline of dots.
    v *= step(uRes.x * 0.5, center.x);

    // Square dot, antialiased at the edge.
    float half_ = 0.5 * uPitch * mix(0.24, 0.86, v);
    vec2 d = abs(gl_FragCoord.xy - center);
    float mask = 1.0 - smoothstep(half_ - 1.0, half_ + 1.0, max(d.x, d.y));

    float density = mask * mix(0.11, 0.30, v);
    gl_FragColor = vec4(mix(uBg, uInk, density), 1.0);
}
`;

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initBackdrop() {
    const canvas = document.getElementById('bg');
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) return; // page still reads fine on the flat background

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('program:', gl.getProgramInfoLog(program));
        return;
    }
    gl.useProgram(program);

    // Single triangle covering the viewport.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uDrift = gl.getUniformLocation(program, 'uDrift');
    const uPitch = gl.getUniformLocation(program, 'uPitch');

    gl.uniform3fv(gl.getUniformLocation(program, 'uBg'), PALETTE.bg);
    gl.uniform3fv(gl.getUniformLocation(program, 'uInk'), PALETTE.ink);

    let dpr = 1;

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const w = Math.floor(canvas.clientWidth * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width === w && canvas.height === h) return false;
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uRes, w, h);
        gl.uniform1f(uPitch, PITCH * dpr);
        return true;
    }

    // Cos/sin keep the drift inside a bounded loop, and JS computes it in
    // double precision, so the shader never sees a large coordinate.
    function render(seconds) {
        const t = seconds * 0.035;
        gl.uniform2f(uDrift, Math.cos(t) * 0.8, Math.sin(t * 0.8) * 0.8);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    resize();

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (still.matches) {
        render(0);
        window.addEventListener('resize', () => { resize(); render(0); });
        return;
    }

    let frame = null;

    function loop(now) {
        resize();
        render(now / 1000);
        frame = requestAnimationFrame(loop);
    }

    function start() {
        if (frame === null) frame = requestAnimationFrame(loop);
    }

    function stop() {
        if (frame !== null) {
            cancelAnimationFrame(frame);
            frame = null;
        }
    }

    // Don't burn cycles on a hidden tab.
    document.addEventListener('visibilitychange', () => {
        document.hidden ? stop() : start();
    });

    window.addEventListener('resize', resize);
    start();
}

initBackdrop();
