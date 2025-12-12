// ============================================
// Simplex Noise Implementation
// ============================================
class SimplexNoise {
    constructor(seed = Math.random()) {
        this.p = new Uint8Array(256);
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);

        for (let i = 0; i < 256; i++) {
            this.p[i] = i;
        }

        // Fisher-Yates shuffle with seed
        let n = 256;
        let random = this.seededRandom(seed);
        while (n > 1) {
            let k = Math.floor(random() * n);
            n--;
            let temp = this.p[n];
            this.p[n] = this.p[k];
            this.p[k] = temp;
        }

        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }

        this.grad3 = new Float32Array([
            1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
            1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
            0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
        ]);

        this.F2 = 0.5 * (Math.sqrt(3) - 1);
        this.G2 = (3 - Math.sqrt(3)) / 6;
    }

    seededRandom(seed) {
        return function() {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
    }

    noise2D(x, y) {
        const { perm, permMod12, grad3, F2, G2 } = this;

        let n0, n1, n2;

        let s = (x + y) * F2;
        let i = Math.floor(x + s);
        let j = Math.floor(y + s);

        let t = (i + j) * G2;
        let X0 = i - t;
        let Y0 = j - t;
        let x0 = x - X0;
        let y0 = y - Y0;

        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; }
        else { i1 = 0; j1 = 1; }

        let x1 = x0 - i1 + G2;
        let y1 = y0 - j1 + G2;
        let x2 = x0 - 1 + 2 * G2;
        let y2 = y0 - 1 + 2 * G2;

        let ii = i & 255;
        let jj = j & 255;

        let gi0 = permMod12[ii + perm[jj]] * 3;
        let gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
        let gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;

        let t0 = 0.5 - x0*x0 - y0*y0;
        if (t0 < 0) n0 = 0;
        else {
            t0 *= t0;
            n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0);
        }

        let t1 = 0.5 - x1*x1 - y1*y1;
        if (t1 < 0) n1 = 0;
        else {
            t1 *= t1;
            n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1);
        }

        let t2 = 0.5 - x2*x2 - y2*y2;
        if (t2 < 0) n2 = 0;
        else {
            t2 *= t2;
            n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2);
        }

        return 70 * (n0 + n1 + n2);
    }
}

// ============================================
// Topographic Animation
// ============================================
const canvas = document.getElementById('topoCanvas');
const ctx = canvas.getContext('2d');
const noise = new SimplexNoise(42);

let width, height;
let time = 0;
let animationId;

// Configuration
const config = {
    scale: 0.003,          // Noise scale (smaller = larger features)
    speed: 0.0003,         // Animation speed
    levels: 12,            // Number of contour levels
    lineWidth: 1,          // Line thickness
    lineColor: 'rgba(255, 255, 255, 0.08)', // Subtle white lines
    cellSize: 8            // Resolution of marching squares
};

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

// Marching squares for contour lines
function getNoiseValue(x, y, t) {
    // Layer multiple octaves for more interesting patterns
    let value = 0;
    value += noise.noise2D(x * config.scale + t, y * config.scale) * 1;
    value += noise.noise2D(x * config.scale * 2 + t * 0.5, y * config.scale * 2) * 0.5;
    value += noise.noise2D(x * config.scale * 4 + t * 0.25, y * config.scale * 4) * 0.25;
    return value / 1.75; // Normalize to roughly -1 to 1
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function drawContourLine(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function marchingSquares(threshold) {
    const cellSize = config.cellSize;
    const cols = Math.ceil(width / cellSize) + 1;
    const rows = Math.ceil(height / cellSize) + 1;

    // Pre-compute noise values
    const values = [];
    for (let j = 0; j < rows; j++) {
        values[j] = [];
        for (let i = 0; i < cols; i++) {
            values[j][i] = getNoiseValue(i * cellSize, j * cellSize, time);
        }
    }

    // Process each cell
    for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
            const x = i * cellSize;
            const y = j * cellSize;

            // Get corner values
            const a = values[j][i];
            const b = values[j][i + 1];
            const c = values[j + 1][i + 1];
            const d = values[j + 1][i];

            // Determine case (16 possible configurations)
            let caseIndex = 0;
            if (a > threshold) caseIndex |= 1;
            if (b > threshold) caseIndex |= 2;
            if (c > threshold) caseIndex |= 4;
            if (d > threshold) caseIndex |= 8;

            // Skip empty or full cells
            if (caseIndex === 0 || caseIndex === 15) continue;

            // Interpolate edge positions
            const top = lerp(x, x + cellSize, (threshold - a) / (b - a));
            const right = lerp(y, y + cellSize, (threshold - b) / (c - b));
            const bottom = lerp(x, x + cellSize, (threshold - d) / (c - d));
            const left = lerp(y, y + cellSize, (threshold - a) / (d - a));

            // Draw lines based on case
            switch (caseIndex) {
                case 1:
                case 14:
                    drawContourLine(x, left, top, y);
                    break;
                case 2:
                case 13:
                    drawContourLine(top, y, x + cellSize, right);
                    break;
                case 3:
                case 12:
                    drawContourLine(x, left, x + cellSize, right);
                    break;
                case 4:
                case 11:
                    drawContourLine(x + cellSize, right, bottom, y + cellSize);
                    break;
                case 5:
                    drawContourLine(x, left, top, y);
                    drawContourLine(x + cellSize, right, bottom, y + cellSize);
                    break;
                case 6:
                case 9:
                    drawContourLine(top, y, bottom, y + cellSize);
                    break;
                case 7:
                case 8:
                    drawContourLine(x, left, bottom, y + cellSize);
                    break;
                case 10:
                    drawContourLine(x, left, bottom, y + cellSize);
                    drawContourLine(top, y, x + cellSize, right);
                    break;
            }
        }
    }
}

function draw() {
    // Clear canvas with dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Set line style
    ctx.strokeStyle = config.lineColor;
    ctx.lineWidth = config.lineWidth;
    ctx.lineCap = 'round';

    // Draw contour lines at different threshold levels
    for (let i = 0; i < config.levels; i++) {
        const threshold = -1 + (2 / config.levels) * i;
        marchingSquares(threshold);
    }

    // Update time for animation
    time += config.speed;

    animationId = requestAnimationFrame(draw);
}

// ============================================
// Page Interactions
// ============================================

// Smooth scrolling for navigation links
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetSection = document.querySelector(targetId);

        if (targetSection) {
            targetSection.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Fade-in animation on page load
window.addEventListener('load', function() {
    const heroSection = document.querySelector('.hero-section');
    if (heroSection) {
        heroSection.style.opacity = '0';
        heroSection.style.transform = 'translateY(20px)';

        setTimeout(() => {
            heroSection.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
            heroSection.style.opacity = '1';
            heroSection.style.transform = 'translateY(0)';
        }, 100);
    }
});

// Navbar background change on scroll
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (scrollTop > 50) {
        navbar.style.backgroundColor = 'rgba(26, 26, 26, 0.98)';
    } else {
        navbar.style.backgroundColor = 'rgba(26, 26, 26, 0.9)';
    }
});

// ============================================
// Initialize
// ============================================
window.addEventListener('resize', resize);
resize();
draw();
