// Credit to TRCustoms, where every level in Browse comes from: its logo,
// and its name in the lettering its own site uses.

import '@fontsource/chakra-petch/latin-500.css';
import { useLayoutEffect, type RefObject } from 'react';
import { SHEETS } from '../ui/gameArt/sheets';
import { letteredWidth } from '../ui/GameText';
import { useTheme } from '../ui/theme';
import { keepFocus } from './labels';
import logo from './trcustoms-logo.svg';

/**
 * In the bar's empty corner where it has room; otherwise over the levels,
 * scrolling away with them. The styles show one of the two.
 */
export function PoweredBy({ place }: { place: 'bar' | 'list' }) {
    return (
        // Left out of the d-pad's walk, which goes from level to level.
        <a className={`powered-by powered-by--${place}`} href="https://trcustoms.org" target="_blank" rel="noreferrer noopener" tabIndex={-1} onMouseDown={keepFocus}>
            <img className="powered-by__logo" src={logo} alt="" draggable={false} />
            <span className="powered-by__words">
                <span className="powered-by__lead">Powered by</span>
                <span className="powered-by__name">TRCustoms.org</span>
            </span>
            {place === 'list' ? (
                <span className="powered-by__note">Every level here, with its pictures and ratings, comes from TRCustoms, home of the community’s custom levels.</span>
            ) : null}
        </a>
    );
}

/** Smaller than this, the credit goes over the levels instead. */
const SMALLEST = 0.75;

/** How much wider than now Library and Browse are in the look whose lettering is widest. */
function widestGain(sections: HTMLElement): number {
    const here = SHEETS[useTheme.getState().theme];
    let gain = 0;
    for (const text of sections.querySelectorAll<HTMLElement>('.gt')) {
        const label = text.querySelector('.sr-only')?.textContent ?? '';
        const now = letteredWidth(label, here);
        const widest = Math.max(...Object.values(SHEETS).map((sheet) => letteredWidth(label, sheet)));
        if (now > 0) gain += text.getBoundingClientRect().width * (widest / now - 1);
    }
    return gain;
}

/**
 * The credit in the bar's corner, beside Library and Browse, at the size the
 * corner leaves it, or over the levels where that is too small. The room
 * goes by the screen's width and the device in hand (its glyphs widen the
 * tabs), so the bar measures it; and it is taken as the look with the
 * widest lettering leaves it, so every look gets the same credit. The
 * screen's data-credit says "bar" or "list", for the styles; the credit's
 * --credit-scale, its size. Over the levels, the bar's credit is hidden but
 * keeps its place, to be measured again. `shown`: whether Browse, and so the
 * credit, is up.
 */
export function useCreditPlace(screenRef: RefObject<HTMLElement | null>, shown: boolean): void {
    useLayoutEffect(() => {
        const screen = screenRef.current;
        const credit = screen?.querySelector<HTMLElement>('.powered-by--bar');
        const sections = screen?.querySelector<HTMLElement>('.custom__tabs--sections');
        const bar = credit?.parentElement;
        if (!screen || !credit || !sections || !bar) return;
        const place = () => {
            // Not drawn at all on a phone, which always has it over the levels.
            if (credit.offsetWidth === 0) return;
            const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
            // The tabs stay in the middle, so half of what they would gain is on the left.
            const shift = widestGain(sections) / 2;
            // Library has no frame while Browse is up: the room goes up to the
            // first thing drawn there, its trigger's glyph or its lettering,
            // short of the bar's gap, but never over the tab itself.
            const first = sections.querySelector('.glyphs, .gt') ?? sections;
            const end = Math.min(sections.getBoundingClientRect().left, first.getBoundingClientRect().left - gap) - shift;
            // The scale leaves the credit's box as it is; only its drawing shrinks.
            const scale = Math.min(1, (end - credit.getBoundingClientRect().left) / credit.offsetWidth);
            screen.dataset.credit = scale >= SMALLEST ? 'bar' : 'list';
            credit.style.setProperty('--credit-scale', String(Math.max(SMALLEST, scale)));
        };
        place();
        // Scaling or hiding the credit, or showing the other one, resizes
        // none of these, so placing it again from the observer cannot loop.
        const observer = new ResizeObserver(place);
        for (const element of [bar, credit, sections]) observer.observe(element);
        return () => observer.disconnect();
    }, [screenRef, shown]);
}
