// Credit to TRCustoms, where every level in Browse comes from: its logo,
// and its name in the lettering its own site uses.

import '@fontsource/chakra-petch/latin-500.css';
import { keepFocus } from './labels';
import logo from './trcustoms-logo.svg';

/**
 * In the bar's empty corner where it has one; otherwise over the levels,
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
