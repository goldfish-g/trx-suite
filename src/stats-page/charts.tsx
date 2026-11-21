// The stats page's charts: stat tiles, ranked bars, the daily line and the
// week heatmap, each in a card with a table view of the same numbers.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { formatDay, WEEKDAYS } from './labels';

export interface TableData {
    columns: string[];
    rows: string[][];
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) return;
        setWidth(element.clientWidth);
        const observer = new ResizeObserver(() => setWidth(element.clientWidth));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, width];
}

export function Card({
    title,
    note,
    table,
    wide = false,
    children,
}: {
    title: string;
    note?: ReactNode;
    table?: TableData;
    wide?: boolean;
    children: ReactNode;
}) {
    const [showTable, setShowTable] = useState(false);
    const headingId = useId();
    return (
        <section className={`card${wide ? ' card--wide' : ''}`} aria-labelledby={headingId}>
            <header className="card__head">
                <h2 id={headingId}>{title}</h2>
                {table !== undefined && table.rows.length > 0 && (
                    <button type="button" className="card__toggle" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>
                        {showTable ? 'Chart' : 'Table'}
                    </button>
                )}
            </header>
            {note !== undefined && <p className="card__note">{note}</p>}
            {showTable && table !== undefined ? <DataTable table={table} /> : children}
        </section>
    );
}

function DataTable({ table }: { table: TableData }) {
    return (
        <div className="table-wrap">
            <table>
                <thead>
                    <tr>
                        {table.columns.map((column) => (
                            <th key={column} scope="col">
                                {column}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, index) => (
                        <tr key={index}>
                            {row.map((cell, column) => (column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function Tile({ label, value, note, live = false }: { label: string; value: string; note?: string; live?: boolean }) {
    return (
        <div className="tile">
            <div className="tile__label">
                {live && <span className="tile__live" aria-hidden="true" />}
                {label}
            </div>
            <div className="tile__value">{value}</div>
            {note !== undefined && <div className="tile__note">{note}</div>}
        </div>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="empty">{children}</p>;
}

// ------------------------------------------------------------------ tooltip

interface TipState {
    x: number;
    y: number;
    value: string;
    label: string;
}

function Tip({ tip, width }: { tip: TipState | null; width: number }) {
    if (tip === null) return null;
    // Kept inside the card: flipped to the left of the pointer near the right edge.
    const flip = tip.x > width - 160;
    return (
        <div className="tip" role="status" style={{ left: tip.x, top: tip.y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}>
            <strong>{tip.value}</strong>
            <span>{tip.label}</span>
        </div>
    );
}

// ------------------------------------------------------------------ bars

export interface BarRow {
    key: string;
    label: ReactNode;
    /** The label as text, for the tooltip and the screen reader. */
    text: string;
    value: number;
    /** How the value is written at the bar's tip. */
    shown: string;
    /** A second line under the label, such as the share. */
    detail?: string;
}

/** Ranked horizontal bars, largest first, one hue, the value at each tip. */
export function Bars({ rows, limit = 10, otherLabel = 'Others' }: { rows: BarRow[]; limit?: number; otherLabel?: string }) {
    const [wrapRef, width] = useWidth<HTMLDivElement>();
    const [tip, setTip] = useState<TipState | null>(null);
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    const shown = rows.length > limit ? rows.slice(0, limit - 1) : rows;
    const rest = rows.slice(shown.length);
    const restValue = rest.reduce((sum, row) => sum + row.value, 0);
    const list: BarRow[] =
        rest.length > 0
            ? [...shown, { key: '__other', label: `${otherLabel} (${rest.length})`, text: `${otherLabel} (${rest.length})`, value: restValue, shown: '' }]
            : shown;
    const max = Math.max(...list.map((row) => row.value), 1);
    const share = (value: number) => (total > 0 ? `${((value / total) * 100).toFixed(value / total < 0.1 ? 1 : 0)}%` : '');

    return (
        <div className="bars" ref={wrapRef} onPointerLeave={() => setTip(null)}>
            <ul>
                {list.map((row) => {
                    const valueText = row.shown || `${row.value}`;
                    const show = (target: Element) => {
                        const box = target.getBoundingClientRect();
                        const outer = wrapRef.current!.getBoundingClientRect();
                        setTip({ x: box.right - outer.left, y: box.top - outer.top + box.height / 2, value: valueText, label: `${row.text} · ${share(row.value)}` });
                    };
                    return (
                        <li
                            key={row.key}
                            tabIndex={0}
                            aria-label={`${row.text}: ${valueText}, ${share(row.value)}`}
                            onPointerEnter={(event) => show(event.currentTarget.querySelector('.bar__fill') ?? event.currentTarget)}
                            onFocus={(event) => show(event.currentTarget.querySelector('.bar__fill') ?? event.currentTarget)}
                            onBlur={() => setTip(null)}
                            className={tip !== null && tip.label.startsWith(`${row.text} ·`) ? 'is-active' : undefined}
                        >
                            <div className="bar__label">
                                <span className="bar__name">{row.label}</span>
                                {row.detail !== undefined && <span className="bar__detail">{row.detail}</span>}
                            </div>
                            <div className="bar__track">
                                <div className="bar__fill" style={{ '--ratio': Math.max(row.value / max, row.value > 0 ? 0.015 : 0) } as React.CSSProperties} />
                                <span className="bar__value">{valueText}</span>
                            </div>
                        </li>
                    );
                })}
            </ul>
            <Tip tip={tip} width={width} />
        </div>
    );
}

// ------------------------------------------------------------------ daily line

const PAD = { top: 12, right: 12, bottom: 28, left: 44 };
const HEIGHT = 220;

/** Round ticks from 0 past the largest value: steps of 1, 2 or 5 times a power of ten. */
function niceTicks(max: number, minStep: number): number[] {
    const rough = Math.max(max / 4, minStep);
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = ([1, 2, 5, 10].find((factor) => factor * power >= rough) ?? 10) * power;
    const top = Math.max(step, Math.ceil(max / step) * step);
    return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
}

/** Space for one date under the chart. */
const DATE_WIDTH = 56;

/** One series by day: a 2px line over a faint wash, a crosshair that snaps to the day. */
export function DailyChart({
    points,
    format,
    axisFormat = format,
    minStep = 1,
    label,
}: {
    points: { day: string; value: number }[];
    /** For the tooltip. */
    format: (n: number) => string;
    /** For the ticks, which are round numbers. */
    axisFormat?: (n: number) => string;
    /** The smallest step between ticks: 1 for things counted whole. */
    minStep?: number;
    label: string;
}) {
    const [wrapRef, width] = useWidth<HTMLDivElement>();
    const [active, setActive] = useState<number | null>(null);
    const plotWidth = Math.max(width - PAD.left - PAD.right, 10);
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const ticks = niceTicks(Math.max(...points.map((point) => point.value), 0), minStep);
    const top = ticks.at(-1)!;
    const x = (index: number) => PAD.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;
    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join('');
    const area = points.length > 0 ? `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
    // Dates every few days, the last day always, none closer than a date's width.
    const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / (DATE_WIDTH + 14)))));
    const last = points.length - 1;
    const labelled = points
        .map((_, index) => index)
        .filter((index) => index === last || (index % labelEvery === 0 && x(last) - x(index) >= DATE_WIDTH + 8));

    const pick = (clientX: number) => {
        const box = wrapRef.current!.getBoundingClientRect();
        const ratio = (clientX - box.left - PAD.left) / plotWidth;
        setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
    };
    const point = active === null ? null : points[active];

    return (
        <div className="daily" ref={wrapRef}>
            {width > 0 && (
                <svg
                    width={width}
                    height={HEIGHT}
                    role="img"
                    aria-label={`${label} by day`}
                    tabIndex={0}
                    onPointerMove={(event) => pick(event.clientX)}
                    onPointerDown={(event) => pick(event.clientX)}
                    onPointerLeave={() => setActive(null)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft') setActive((current) => Math.max(0, (current ?? points.length) - 1));
                        if (event.key === 'ArrowRight') setActive((current) => Math.min(points.length - 1, (current ?? -1) + 1));
                    }}
                    onBlur={() => setActive(null)}
                >
                    {ticks.map((tick) => (
                        <g key={tick}>
                            <line className="gridline" x1={PAD.left} x2={PAD.left + plotWidth} y1={y(tick)} y2={y(tick)} />
                            <text className="axis" x={PAD.left - 8} y={y(tick)} dy="0.35em" textAnchor="end">
                                {axisFormat(tick)}
                            </text>
                        </g>
                    ))}
                    {labelled.map((index) => (
                        <text
                            key={index}
                            className="axis"
                            x={x(index)}
                            y={HEIGHT - 8}
                            textAnchor={index === 0 && points.length > 1 ? 'start' : index === points.length - 1 && points.length > 1 ? 'end' : 'middle'}
                        >
                            {formatDay(points[index]!.day)}
                        </text>
                    ))}
                    <path className="daily__area" d={area} />
                    <path className="daily__line" d={line} />
                    {points.length > 0 && <circle className="daily__end" cx={x(points.length - 1)} cy={y(points.at(-1)!.value)} r={4} />}
                    {point != null && active !== null && (
                        <g>
                            <line className="crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotHeight} />
                            <circle className="daily__dot" cx={x(active)} cy={y(point.value)} r={4} />
                        </g>
                    )}
                </svg>
            )}
            {point != null && active !== null && (
                <Tip tip={{ x: x(active), y: y(point.value), value: format(point.value), label: formatDay(point.day, true) }} width={width} />
            )}
        </div>
    );
}

// ------------------------------------------------------------------ heatmap

/** Amber, one hue, darkest for the least (checked against the card surface). */
const HEAT = ['#6A4A1C', '#8E6222', '#B47D2A', '#DA9833', '#F5BA62'];

/** Minutes played by weekday and hour, in the players' own time. */
export function Heatmap({ hours, format }: { hours: number[]; format: (n: number) => string }) {
    const [wrapRef, width] = useWidth<HTMLDivElement>();
    const [tip, setTip] = useState<TipState | null>(null);
    const nonZero = hours.filter((n) => n > 0).sort((a, b) => a - b);
    // Steps by quantile, so a few long evenings do not wash out the rest.
    const steps = HEAT.map((_, index) => nonZero[Math.floor(((index + 1) / HEAT.length) * (nonZero.length - 1))] ?? 0);
    const colour = (n: number) => (n <= 0 ? undefined : HEAT[steps.findIndex((step) => n <= step)] ?? HEAT.at(-1));
    const labelWidth = 36;
    // 24 cells and their 2px gaps, beside the day names.
    const cell = Math.max(8, Math.min(28, Math.floor((width - labelWidth - 24 * 2) / 24)));

    useEffect(() => setTip(null), [hours]);

    return (
        <div className="heat" ref={wrapRef} onPointerLeave={() => setTip(null)}>
            <div className="heat__grid" style={{ gridTemplateColumns: `${labelWidth}px repeat(24, ${cell}px)` }} role="grid" aria-label="Minutes played by day of the week and hour">
                {WEEKDAYS.map((day, weekday) => (
                    <div key={day} role="row" className="heat__row">
                        <div className="heat__day" role="rowheader">
                            {day.slice(0, 3)}
                        </div>
                        {Array.from({ length: 24 }, (_, hour) => {
                            const n = hours[weekday * 24 + hour] ?? 0;
                            const text = `${day} ${String(hour).padStart(2, '0')}:00`;
                            const show = (target: HTMLElement) => {
                                const box = target.getBoundingClientRect();
                                const outer = wrapRef.current!.getBoundingClientRect();
                                setTip({ x: box.left - outer.left + box.width / 2, y: box.top - outer.top + box.height / 2, value: n > 0 ? format(n) : 'Nobody', label: text });
                            };
                            return (
                                <div
                                    key={hour}
                                    role="gridcell"
                                    tabIndex={weekday === 0 && hour === 0 ? 0 : -1}
                                    aria-label={`${text}: ${n > 0 ? format(n) : 'nobody played'}`}
                                    className={`heat__cell${n > 0 ? '' : ' heat__cell--none'}`}
                                    style={{ width: cell, height: cell, background: colour(n) }}
                                    onPointerEnter={(event) => show(event.currentTarget)}
                                    onFocus={(event) => show(event.currentTarget)}
                                    onKeyDown={(event) => {
                                        const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 };
                                        const move = moves[event.key];
                                        if (move === undefined) return;
                                        event.preventDefault();
                                        const cells = [...wrapRef.current!.querySelectorAll<HTMLElement>('.heat__cell')];
                                        cells[Math.min(cells.length - 1, Math.max(0, weekday * 24 + hour + move))]?.focus();
                                    }}
                                />
                            );
                        })}
                    </div>
                ))}
                <div className="heat__row heat__hours" aria-hidden="true">
                    <div />
                    {Array.from({ length: 24 }, (_, hour) => (
                        <div key={hour} className="heat__hour" style={{ width: cell }}>
                            {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
                        </div>
                    ))}
                </div>
            </div>
            <div className="heat__legend" aria-hidden="true">
                <span>Less</span>
                {HEAT.map((step) => (
                    <i key={step} style={{ background: step }} />
                ))}
                <span>More</span>
            </div>
            <Tip tip={tip} width={width} />
        </div>
    );
}
