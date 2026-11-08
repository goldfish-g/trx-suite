// The game's lettering and button icons are pixel art, sharp only when each
// of their pixels covers a whole number of the screen's. The styles size them
// from --dpr, the screen's pixels per CSS pixel, which this keeps up to date
// as the page is zoomed or the window moves to another screen.
//
// Rounding to whole screen pixels is only close enough when there are many
// of them, or a whole number, per CSS pixel. Between 1 and 2, as on a laptop
// at 125 %, it would make the lettering a fifth smaller here and a fifth
// bigger there; --snap 0 lets the art take the size the styles ask for.

export function trackPixelRatio(): void {
    const root = document.documentElement;
    const watch = () => {
        const ratio = window.devicePixelRatio || 1;
        root.style.setProperty('--dpr', String(ratio));
        root.style.setProperty('--snap', ratio >= 2 || Number.isInteger(ratio) ? '1' : '0');
        matchMedia(`(resolution: ${ratio}dppx)`).addEventListener('change', watch, { once: true });
    };
    watch();
}
