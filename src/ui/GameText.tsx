// Text in the games' own lettering: the in-game font of the theme's game,
// glyph by glyph off the sheet TRX draws it from. The styles give the size,
// as --gs, the number of screen pixels per pixel of the font (rounded so it
// stays sharp). Text the font has no glyphs for, such as a name in another
// script, is set in the text font instead, whole.

import { Fragment, type CSSProperties } from 'react';
import { SHEETS, type Sheet } from './gameArt/sheets';
import { useTheme } from './theme';

export function canLetter(text: string, sheet: Sheet): boolean {
    for (const char of text) if (char !== ' ' && sheet.glyphs[char] === undefined) return false;
    return true;
}

export function GameText({ text, className }: { text: string; className?: string }) {
    const sheet = SHEETS[useTheme((state) => state.theme)];
    if (!canLetter(text, sheet)) return <span className={`gt gt--plain ${className ?? ''}`}>{text}</span>;
    const words = text.split(' ');
    return (
        <span className={`gt ${className ?? ''}`}>
            <span className="sr-only">{text}</span>
            <span className="gt__line" aria-hidden="true">
                {words.map((word, index) => (
                    <Fragment key={index}>
                        {index > 0 ? <span className="gt__space" /> : null}
                        {word !== '' ? <span className="gt__word">{[...word].map((char, i) => glyph(sheet, char, i))}</span> : null}
                    </Fragment>
                ))}
            </span>
        </span>
    );
}

function glyph(sheet: Sheet, char: string, index: number) {
    const [x, y, w, h, advance, left, top] = sheet.glyphs[char]!;
    const style = { '--x': x, '--y': y, '--w': w, '--h': h, '--a': advance, '--l': left, '--t': top } as CSSProperties;
    return <i key={index} className="gt__g" style={style} />;
}
