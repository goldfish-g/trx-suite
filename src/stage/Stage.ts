// The one WebGL canvas behind the menus. It draws the level flyby first and
// the ring of games over it, sharing a renderer so phones keep a single
// GPU context.

import * as THREE from 'three';

export interface Viewport {
    width: number;
    height: number;
    aspect: number;
}

export interface Layer {
    update(dt: number, viewport: Viewport): void;
    render(renderer: THREE.WebGLRenderer): void;
    dispose(): void;
}

/** The flyby: it only needs the screen's aspect ratio. */
export interface BackgroundLayer {
    update(dt: number, aspect: number): void;
    render(renderer: THREE.WebGLRenderer): void;
    dispose(): void;
}

export class Stage {
    readonly renderer: THREE.WebGLRenderer;
    background: BackgroundLayer | null = null;
    foreground: Layer | null = null;
    /** Off while a screen covers the menu and only the level should show through it. */
    showForeground = true;
    /** Called once per frame after drawing, e.g. to place labels over 3D items. */
    onFrame: ((viewport: Viewport) => void) | null = null;

    private frame = 0;
    private last = 0;
    private readonly canvas: HTMLCanvasElement;
    private readonly observer: ResizeObserver;
    private viewport: Viewport = { width: 1, height: 1, aspect: 1 };
    private readonly maxRatio: number;
    private ratio: number;
    private slowFrames = 0;
    private fastFrames = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            powerPreference: 'high-performance',
            stencil: false,
        });
        this.renderer.autoClear = false;
        this.renderer.setClearColor(0x050608, 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        // A backdrop doesn't need every pixel of a phone's dense screen.
        this.maxRatio = Math.min(window.devicePixelRatio, 1.5);
        this.ratio = this.maxRatio;
        this.renderer.setPixelRatio(this.ratio);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas);
        this.resize();
    }

    private resize(): void {
        const width = Math.max(1, this.canvas.clientWidth);
        const height = Math.max(1, this.canvas.clientHeight);
        this.renderer.setSize(width, height, false);
        this.viewport = { width, height, aspect: width / height };
    }

    start(): void {
        if (this.frame !== 0) return;
        this.last = performance.now();
        const tick = (now: number) => {
            this.frame = requestAnimationFrame(tick);
            const elapsed = (now - this.last) / 1000;
            const dt = Math.min(elapsed, 0.1);
            this.last = now;
            this.adapt(elapsed);
            this.draw(dt);
        };
        this.frame = requestAnimationFrame(tick);
    }

    stop(): void {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
    }

    /**
     * Trades sharpness for smoothness: when frames keep coming slower than
     * 45 a second, draw fewer pixels; when they come easily again, more.
     */
    private adapt(elapsed: number): void {
        if (elapsed > 0.5) return; // the tab was in the background
        if (elapsed > 1 / 45) {
            this.slowFrames++;
            this.fastFrames = 0;
        } else if (elapsed < 1 / 58) {
            this.fastFrames++;
            this.slowFrames = Math.max(0, this.slowFrames - 1);
        }
        let next = this.ratio;
        if (this.slowFrames > 45 && this.ratio > 0.6) next = Math.max(0.6, this.ratio - 0.2);
        else if (this.fastFrames > 600 && this.ratio < this.maxRatio) next = Math.min(this.maxRatio, this.ratio + 0.2);
        if (next !== this.ratio) {
            this.ratio = next;
            this.slowFrames = 0;
            this.fastFrames = 0;
            this.renderer.setPixelRatio(next);
            this.resize();
        }
    }

    private draw(dt: number): void {
        const renderer = this.renderer;
        renderer.clear(true, true, false);
        if (this.background !== null) {
            this.background.update(dt, this.viewport.aspect);
            this.background.render(renderer);
            renderer.clearDepth();
        }
        if (this.foreground !== null && this.showForeground) {
            this.foreground.update(dt, this.viewport);
            this.foreground.render(renderer);
        }
        this.onFrame?.(this.viewport);
    }

    setBackground(layer: Stage['background']): void {
        const old = this.background;
        this.background = layer;
        old?.dispose();
    }

    dispose(): void {
        this.stop();
        this.observer.disconnect();
        this.background?.dispose();
        this.foreground?.dispose();
        this.renderer.dispose();
    }
}
