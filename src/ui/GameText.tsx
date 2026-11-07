// Text in the games' own lettering: TR1's gold font, glyph by glyph off the
// sheet TRX draws it from. The styles give the size, as --gs, the number of
// screen pixels per pixel of the font (rounded so it stays sharp). Text the
// font has no glyphs for, such as a name in another script, is set in the
// text font instead, whole.

import { Fragment, type CSSProperties } from 'react';
import { GLYPHS } from './gameArt/sheets';

export function canLetter(text: string): boolean {
    for (const char of text) if (char !== ' ' && GLYPHS[char] === undefined) return false;
    return true;
}

export function GameText({ text, className }: { text: string; className?: string }) {
    if (!canLetter(text)) return <span className={`gt gt--plain ${className ?? ''}`}>{text}</span>;
    const words = text.split(' ');
    return (
        <span className={`gt ${className ?? ''}`}>
            <span className="sr-only">{text}</span>
            <span className="gt__line" aria-hidden="true">
                {words.map((word, index) => (
                    <Fragment key={index}>
                        {index > 0 ? <span className="gt__space" /> : null}
                        {word !== '' ? <span className="gt__word">{[...word].map(glyph)}</span> : null}
                    </Fragment>
                ))}
            </span>
        </span>
    );
}

function glyph(char: string, index: number) {
    const [x, y, w, h, advance, dx] = GLYPHS[char]!;
    const style = { '--x': x, '--y': y, '--w': w, '--h': h, '--a': advance, '--d': dx } as CSSProperties;
    return <i key={index} className="gt__g" style={style} />;
}
