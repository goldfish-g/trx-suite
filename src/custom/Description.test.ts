import { describe, expect, it } from 'vitest';
import { blocksOf } from './Description';

describe('blocksOf', () => {
    it('reads TRCustoms’ Markdown: headings, rules, quotes, lists, its own tags', () => {
        // From a real description, shortened.
        const text = [
            '---\r\n---\r\n---\r\n\r\n### // BOOTING UP //\r\n\r\n---\r\n[center]![](https://i.ibb.co/x/test.png)[/center]\r\n\r\n---\r\n',
            '\r\n#### GAME OFFERS 3 DIFFICULTIES\r\n>Regular is the normal mode. \r\n> Agony is punishing.\r\n\r\n',
            '[o]Coloured[/o] words\r\nand a second line\r\n\r\n- one\r\n- two\r\n\r\n---\r\n---',
        ].join('');
        expect(blocksOf(text)).toEqual([
            { kind: 'heading', text: '// BOOTING UP //' },
            { kind: 'rule' },
            { kind: 'heading', text: 'GAME OFFERS 3 DIFFICULTIES' },
            { kind: 'quote', lines: ['Regular is the normal mode.', 'Agony is punishing.'] },
            { kind: 'paragraph', lines: ['Coloured words', 'and a second line'] },
            { kind: 'list', items: ['one', 'two'] },
        ]);
    });

    it('gives nothing for an empty description', () => {
        expect(blocksOf('  \n\n---\n')).toEqual([]);
    });
});
