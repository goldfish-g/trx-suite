// The game's lettering and button icons are pixel art, sharp only when each
// of their pixels covers a whole number of the screen's. The styles size them
// from --dpr, the screen's pixels per CSS pixel, which this keeps up to date
// as the page is zoomed or the window moves to another screen.

export function trackPixelRatio(): void {
    const root = document.documentElement;
    const watch = () => {
        const ratio = window.devicePixelRatio || 1;
        root.style.setProperty('--dpr', String(ratio));
        matchMedia(`(resolution: ${ratio}dppx)`).addEventListener('change', watch, { once: true });
    };
    watch();
}
