// Small pixel icons, drawn inline so they work offline and follow the text
// colour. Each is twelve pixels square, drawn below as rows of # for the
// pixels that are set, to sit beside the games' pixel lettering.

import type { ReactNode } from 'react';

/** One square per set pixel, joined along each row. */
function pixels(rows: readonly string[]): string {
    let path = '';
    rows.forEach((row, y) => {
        for (const match of row.matchAll(/#+/g)) path += `M${match.index} ${y}h${match[0].length}v1h-${match[0].length}z`;
    });
    return path;
}

function Icon({ rows, label }: { rows: readonly string[]; label?: string }) {
    return (
        <svg
            className="icon"
            viewBox="0 0 12 12"
            aria-hidden={label === undefined}
            aria-label={label}
            role={label === undefined ? undefined : 'img'}
        >
            <path d={pixels(rows)} />
        </svg>
    );
}

const icon = (rows: readonly string[]) => () => <Icon rows={rows} />;

// prettier-ignore
export const LockIcon = icon([
    '....####....',
    '...#....#...',
    '..#......#..',
    '..#......#..',
    '..#......#..',
    '.##########.',
    '.##########.',
    '.####..####.',
    '.####..####.',
    '.#####.####.',
    '.##########.',
    '.##########.',
]);

// prettier-ignore
export const UserIcon = icon([
    '....####....',
    '...######...',
    '...######...',
    '...######...',
    '....####....',
    '............',
    '..########..',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '............',
]);

// prettier-ignore
export const GearIcon = icon([
    '.....##.....',
    '..#.####.#..',
    '.##########.',
    '..###..###..',
    '.###....###.',
    '####....####',
    '####....####',
    '.###....###.',
    '..###..###..',
    '.##########.',
    '..#.####.#..',
    '.....##.....',
]);

// prettier-ignore
export const DownloadIcon = icon([
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '..#..##..#..',
    '..##.##.##..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '.##########.',
    '.##########.',
]);

// prettier-ignore
export const PlayIcon = icon([
    '..#.........',
    '..##........',
    '..###.......',
    '..####......',
    '..#####.....',
    '..######....',
    '..######....',
    '..#####.....',
    '..####......',
    '..###.......',
    '..##........',
    '..#.........',
]);

// prettier-ignore
export const ChevronLeft = icon([
    '.......##...',
    '......###...',
    '.....###....',
    '....###.....',
    '...###......',
    '..###.......',
    '..###.......',
    '...###......',
    '....###.....',
    '.....###....',
    '......###...',
    '.......##...',
]);

// prettier-ignore
export const ChevronRight = icon([
    '...##.......',
    '...###......',
    '....###.....',
    '.....###....',
    '......###...',
    '.......###..',
    '.......###..',
    '......###...',
    '.....###....',
    '....###.....',
    '...###......',
    '...##.......',
]);

// prettier-ignore
export const FolderIcon = icon([
    '............',
    '.####.......',
    '.#..#######.',
    '.#........#.',
    '.##########.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.##########.',
    '............',
]);

// prettier-ignore
export const FileIcon = icon([
    '.######.....',
    '.#....##....',
    '.#....#.#...',
    '.#....####..',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.#.......#..',
    '.#########..',
    '............',
]);

// prettier-ignore
export const InstallIcon = icon([
    '..########..',
    '..#......#..',
    '..#..##..#..',
    '..#..##..#..',
    '..#..##..#..',
    '..#.####.#..',
    '..#..##..#..',
    '..#......#..',
    '..#......#..',
    '..#..##..#..',
    '..########..',
    '............',
]);

// prettier-ignore
export const CheckIcon = icon([
    '............',
    '..........##',
    '.........##.',
    '........##..',
    '.......##...',
    '##....##....',
    '.##..##.....',
    '..####......',
    '...##.......',
    '............',
    '............',
    '............',
]);

// prettier-ignore
export const TrashIcon = icon([
    '....####....',
    '.##########.',
    '............',
    '..########..',
    '..#.#..#.#..',
    '..#.#..#.#..',
    '..#.#..#.#..',
    '..#.#..#.#..',
    '..#.#..#.#..',
    '..#.#..#.#..',
    '..########..',
    '............',
]);

// prettier-ignore
export const PlusIcon = icon([
    '............',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.##########.',
    '.##########.',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
]);

// prettier-ignore
export const ExternalIcon = icon([
    '.......#####',
    '..........##',
    '.........###',
    '........###.',
    '.......###..',
    '......###...',
    '.####.##..#.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.#........#.',
    '.##########.',
]);

// prettier-ignore
export const SearchIcon = icon([
    '...####.....',
    '..#....#....',
    '.#......#...',
    '.#......#...',
    '.#......#...',
    '.#......#...',
    '..#....#....',
    '...####.#...',
    '.........#..',
    '..........#.',
    '...........#',
    '............',
]);

/** A neutral mark for a store, in its initials: logos are their owners' to use. */
export function StoreMark({ provider }: { provider: 'steam' }): ReactNode {
    return <span className={`store-mark store-mark--${provider}`}>S</span>;
}
