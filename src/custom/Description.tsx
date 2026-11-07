// A level's description as TRCustoms writes it: Markdown, with tags of its
// own such as the colours [o]…[/o] and [center]…[/center]. This shows
// paragraphs, line breaks, headings, rules, quotes, lists, bold, italics and
// links, as React elements, never as HTML: the text is the author's, not
// ours. Pictures are left out; they live on other sites, which a cross-origin
// isolated page cannot show.

import type { ReactNode } from 'react';

/** TRCustoms' colour tags, [o] … [/o], and its alignment tags. */
const SITE_TAG = /\[\/?(?:[a-z]|center|left|right)\]/gi;
const PICTURE = /!\[[^\]]*\]\([^)]*\)/g;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const ITEM = /^\s*(?:[-*•+]|\d+[.)])\s+(.*)$/;
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+)/g;

type Block =
    | { kind: 'paragraph'; lines: string[] }
    | { kind: 'heading'; text: string }
    | { kind: 'rule' }
    | { kind: 'quote'; lines: string[] }
    | { kind: 'list'; items: string[] };

/** Splits the text into blocks, line by line, as Markdown reads it. */
export function blocksOf(text: string): Block[] {
    const blocks: Block[] = [];
    let open: Block | null = null;
    const close = () => {
        if (open !== null) blocks.push(open);
        open = null;
    };
    const lines = text.replace(/\r\n?/g, '\n').replace(SITE_TAG, '').replace(PICTURE, '').split('\n');
    for (const line of lines) {
        if (line.trim() === '') {
            close();
            continue;
        }
        const heading = HEADING.exec(line);
        const quote = QUOTE.exec(line);
        const item = ITEM.exec(line);
        if (RULE.test(line)) {
            close();
            blocks.push({ kind: 'rule' });
        } else if (heading !== null) {
            close();
            if (heading[1]!.trim() !== '') blocks.push({ kind: 'heading', text: heading[1]!.trim() });
        } else if (quote !== null) {
            if (open?.kind !== 'quote') {
                close();
                open = { kind: 'quote', lines: [] };
            }
            open.lines.push(quote[1]!.trim());
        } else if (item !== null) {
            if (open?.kind !== 'list') {
                close();
                open = { kind: 'list', items: [] };
            }
            open.items.push(item[1]!.trim());
        } else {
            if (open?.kind !== 'paragraph') {
                close();
                open = { kind: 'paragraph', lines: [] };
            }
            open.lines.push(line.trim());
        }
    }
    close();
    // Rules that frame the text, or stand two in a row, are decoration.
    const kept = blocks.filter((block, index) => block.kind !== 'rule' || blocks[index - 1]?.kind !== 'rule');
    while (kept[0]?.kind === 'rule') kept.shift();
    while (kept.at(-1)?.kind === 'rule') kept.pop();
    return kept;
}

function inline(text: string, key: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let last = 0;
    let index = 0;
    for (const match of text.matchAll(INLINE)) {
        const token = match[0];
        const at = match.index;
        if (at > last) parts.push(text.slice(last, at));
        const id = `${key}-${index++}`;
        if (token.startsWith('**') || token.startsWith('__')) {
            parts.push(<strong key={id}>{inline(token.slice(2, -2), id)}</strong>);
        } else if (token.startsWith('[')) {
            const split = token.indexOf('](');
            parts.push(
                <a key={id} href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer noopener">
                    {token.slice(1, split)}
                </a>,
            );
        } else if (token.startsWith('http')) {
            parts.push(
                <a key={id} href={token} target="_blank" rel="noreferrer noopener">
                    {token}
                </a>,
            );
        } else {
            parts.push(<em key={id}>{inline(token.slice(1, -1), id)}</em>);
        }
        last = at + token.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

function lines(texts: string[], key: string): ReactNode[] {
    return texts.map((text, index) => (
        <span key={index}>
            {index > 0 ? <br /> : null}
            {inline(text, `${key}-${index}`)}
        </span>
    ));
}

export function Description({ text }: { text: string }) {
    const blocks = blocksOf(text);
    if (blocks.length === 0) return <p className="description__empty">The author wrote no description.</p>;
    return (
        <div className="description">
            {blocks.map((block, index) => {
                switch (block.kind) {
                    case 'heading':
                        return <h4 key={index}>{inline(block.text, `h${index}`)}</h4>;
                    case 'rule':
                        return <hr key={index} />;
                    case 'quote':
                        return <blockquote key={index}>{lines(block.lines, `q${index}`)}</blockquote>;
                    case 'list':
                        return (
                            <ul key={index}>
                                {block.items.map((item, itemIndex) => (
                                    <li key={itemIndex}>{inline(item, `l${index}-${itemIndex}`)}</li>
                                ))}
                            </ul>
                        );
                    case 'paragraph':
                        return <p key={index}>{lines(block.lines, `p${index}`)}</p>;
                }
            })}
        </div>
    );
}
