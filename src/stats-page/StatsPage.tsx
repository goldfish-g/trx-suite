// stats.tombs.nexus: how many people play, from where, on what, and what
// Lara got up to. Public, and made only of counts (see the note at the end).

import { useCallback, useEffect, useId, useState } from 'react';
import type { LevelStats, StatsRange, StatsResponse, Tally } from '../../shared/stats.ts';
import { BrandLogo } from '../ui/BrandLogo';
import { Bars, Card, DailyChart, Empty, Heatmap, Tile, type BarRow, type TableData } from './charts';
import {
    countryName,
    formatBytes,
    formatCount,
    formatDay,
    formatMetres,
    formatMinutes,
    formatPercent,
    gameName,
    languageName,
    nameOf,
    steamProductName,
    WEEKDAYS,
} from './labels';

const RANGES: { range: StatsRange; label: string }[] = [
    { range: '7', label: '7 days' },
    { range: '30', label: '30 days' },
    { range: '90', label: '90 days' },
    { range: 'all', label: 'All time' },
];

const REFRESH_MS = 60_000;

/** The app this page counts: stats.tombs.nexus belongs to tombs.nexus. */
const APP_URL = location.hostname.startsWith('stats.') ? `${location.protocol}//${location.host.slice('stats.'.length)}/` : '/';
const APP_NAME = location.hostname.startsWith('stats.') ? location.hostname.slice('stats.'.length) : 'tombs.nexus';

type Metric = 'visits' | 'visitors' | 'minutes' | 'signIns';
const METRICS: { metric: Metric; label: string; scale: number; step: number; format: (n: number) => string; axis: (n: number) => string }[] = [
    { metric: 'visitors', label: 'People', scale: 1, step: 1, format: formatCount, axis: formatCount },
    { metric: 'visits', label: 'Visits', scale: 1, step: 1, format: formatCount, axis: formatCount },
    // Charted in hours, so the ticks are round hours.
    {
        metric: 'minutes',
        label: 'Time played',
        scale: 1 / 60,
        step: 0.5,
        format: (hours) => formatMinutes(hours * 60),
        axis: (hours) => `${Number.isInteger(hours) ? formatCount(hours) : hours.toFixed(1)} h`,
    },
    { metric: 'signIns', label: 'Steam sign-ins', scale: 1, step: 1, format: formatCount, axis: formatCount },
];

function tallyRows(tally: Tally[], name: (key: string) => string, format: (n: number) => string = formatCount): BarRow[] {
    return tally.map((entry) => ({ key: entry.key, label: name(entry.key), text: name(entry.key), value: entry.n, shown: format(entry.n) }));
}

function tallyTable(tally: Tally[], name: (key: string) => string, column: string, format: (n: number) => string = formatCount): TableData {
    const total = tally.reduce((sum, entry) => sum + entry.n, 0);
    return { columns: ['', column, 'Share'], rows: tally.map((entry) => [name(entry.key), format(entry.n), formatPercent(entry.n, total)]) };
}

export function StatsPage() {
    const [range, setRange] = useState<StatsRange>('30');
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [metric, setMetric] = useState<Metric>('visitors');

    const load = useCallback(async (wanted: StatsRange, signal?: AbortSignal) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/stats?range=${wanted}`, { signal });
            if (!response.ok) throw new Error(`The server answered ${response.status}.`);
            setStats((await response.json()) as StatsResponse);
            setError(null);
        } catch (failure) {
            if (signal?.aborted) return;
            setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(range, controller.signal);
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void load(range, controller.signal);
        }, REFRESH_MS);
        return () => {
            controller.abort();
            clearInterval(timer);
        };
    }, [range, load]);

    return (
        <main className="page">
            <header className="top">
                <a className="top__brand" href={APP_URL}>
                    <BrandLogo className="top__logo" />
                </a>
                <div className="top__title">
                    <h1>Stats</h1>
                    <p>
                        Everyone playing on <a href={APP_URL}>{APP_NAME}</a>, counted without knowing who they are.
                        {stats?.since != null && <> Counting since {formatDay(stats.since, true)}.</>}
                    </p>
                </div>
            </header>

            <nav className="ranges" aria-label="Time range">
                {RANGES.map((entry) => (
                    <button key={entry.range} type="button" aria-pressed={range === entry.range} onClick={() => setRange(entry.range)}>
                        {entry.label}
                    </button>
                ))}
            </nav>

            {error !== null && stats === null && <Empty>The stats could not be loaded: {error}</Empty>}
            {stats !== null && <Sections stats={stats} loading={loading} metric={metric} onMetric={setMetric} />}

            <footer className="foot">
                <h2>What is counted</h2>
                <p>
                    The app tells this server when it opens (and the first time it opens as an installed app), which kind of screen and
                    controls it is used with, each minute a game is on screen, what finished installing, and what Lara did, read from the save
                    files. It sends no name and no id of the player or the device, and sets no cookie for it.
                </p>
                <p>
                    The server looks up the country of an address the moment a visit arrives and keeps only the country. To count a person
                    once a day, it keeps a hash of their address, and to count their devices one of their address and browser, made with a
                    key that changes every day; they go after two days, so no one can be followed from one day to the next. People logged in
                    with Steam are counted by a keyed hash of their Steam account, which is how this page knows how many come back, and
                    which Steam games logged-in users own.
                </p>
                <p className="foot__credits">
                    Country lookup: <a href="https://db-ip.com">IP Geolocation by DB-IP</a> (CC BY 4.0). Custom levels:{' '}
                    <a href="https://trcustoms.org">TRCustoms</a>. Engine: <a href="https://github.com/LostArtefacts/TRX">TRX</a>.
                </p>
            </footer>
        </main>
    );
}

function Sections({ stats, loading, metric, onMetric }: { stats: StatsResponse; loading: boolean; metric: Metric; onMetric: (metric: Metric) => void }) {
    const { totals } = stats;
    const chosen = METRICS.find((entry) => entry.metric === metric)!;
    const points = stats.daily.map((day) => ({ day: day.day, value: day[metric] * chosen.scale }));
    const accuracy = stats.lara.ammoUsed > 0 ? formatPercent(stats.lara.ammoHits, stats.lara.ammoUsed) : '–';
    const visitorsTotal = stats.countries.reduce((sum, entry) => sum + entry.n, 0);

    return (
        <div className={`sections${loading ? ' is-loading' : ''}`} aria-busy={loading}>
            <div className="tiles">
                <Tile live label="Playing right now" value={formatCount(totals.playingNow)} />
                <Tile label="People" value={formatCount(totals.visitors)} note={`${formatCount(totals.visits)} visits`} />
                <Tile label="Time played" value={formatMinutes(totals.minutesPlayed)} note={`${formatCount(totals.plays)} game sessions`} />
                <Tile label="Custom levels installed" value={formatCount(totals.levelInstalls + totals.fileInstalls)} note={`${formatCount(totals.levelInstalls)} from TRCustoms`} />
                <Tile
                    label="Logged in users"
                    value={formatCount(totals.players)}
                    note={`${formatCount(totals.returningPlayers)} returning · ${formatCount(totals.newPlayers)} new`}
                />
                <Tile label="Installed as an app" value={formatCount(totals.appInstalls)} note={`${formatCount(totals.gameInstalls)} games installed`} />
            </div>

            <Card
                wide
                title={`${chosen.label} by day`}
                note="Days in UTC."
                table={{ columns: ['Day', ...METRICS.map((entry) => entry.label)], rows: stats.daily.map((day) => [formatDay(day.day, true), formatCount(day.visitors), formatCount(day.visits), formatMinutes(day.minutes), formatCount(day.signIns)]) }}
            >
                <div className="metrics" role="group" aria-label="What the chart shows">
                    {METRICS.map((entry) => (
                        <button key={entry.metric} type="button" aria-pressed={metric === entry.metric} onClick={() => onMetric(entry.metric)}>
                            {entry.label}
                        </button>
                    ))}
                </div>
                <DailyChart points={points} format={chosen.format} axisFormat={chosen.axis} minStep={chosen.step} label={chosen.label} />
            </Card>

            <div className="grid">
                <Card title="Where they are" note="People a day, by country." table={tallyTable(stats.countries, countryName, 'People')}>
                    {stats.countries.length === 0 ? <Empty>No one yet.</Empty> : <Bars rows={tallyRows(stats.countries, countryName)} limit={12} otherLabel="Other countries" />}
                </Card>

                <Card
                    title="Games played"
                    table={{
                        columns: ['Game', 'Time played', 'Sessions', 'Installs', 'Lara died'],
                        rows: stats.games.map((game) => [gameName(game.game), formatMinutes(game.minutes), formatCount(game.plays), formatCount(game.installs), formatCount(game.deaths)]),
                    }}
                >
                    {stats.games.length === 0 ? (
                        <Empty>No one has played yet.</Empty>
                    ) : (
                        <Bars
                            rows={stats.games.map((game) => ({
                                key: game.game,
                                label: gameName(game.game),
                                text: gameName(game.game),
                                value: game.minutes,
                                shown: formatMinutes(game.minutes),
                                detail: `${formatCount(game.plays)} sessions · ${formatCount(game.installs)} installs`,
                            }))}
                        />
                    )}
                </Card>
            </div>

            <Card
                wide
                title="Most installed custom levels"
                note={`From TRCustoms, installed through ${APP_NAME}.`}
                table={{
                    columns: ['Level', 'By', 'Installs', 'Time played'],
                    rows: stats.levels.map((level) => [level.name, level.authors.join(', '), formatCount(level.installs), formatMinutes(level.minutes)]),
                }}
            >
                {stats.levels.length === 0 ? <Empty>No custom level installed yet.</Empty> : <LevelList levels={stats.levels} />}
            </Card>

            <Card
                wide
                title="What Lara did"
                note="Read from the save files after each game, so only what happens in a save counts."
                table={{
                    columns: ['', 'Count'],
                    rows: [
                        ['Deaths', formatCount(stats.lara.deaths)],
                        ['Secrets found', formatCount(stats.lara.secrets)],
                        ['Enemies killed', formatCount(stats.lara.kills)],
                        ['Pickups taken', formatCount(stats.lara.pickups)],
                        ['Distance travelled', formatMetres(stats.lara.distance)],
                        ['Levels finished', formatCount(stats.lara.levels)],
                        ['Medipacks used', formatCount(stats.lara.medipacks)],
                        ['Shots fired', formatCount(stats.lara.ammoUsed)],
                        ['Shots that hit', formatCount(stats.lara.ammoHits)],
                    ],
                }}
            >
                <div className="lara">
                    <Tile label="Deaths" value={formatCount(stats.lara.deaths)} />
                    <Tile label="Secrets found" value={formatCount(stats.lara.secrets)} />
                    <Tile label="Enemies killed" value={formatCount(stats.lara.kills)} />
                    <Tile label="Pickups taken" value={formatCount(stats.lara.pickups)} />
                    <Tile label="Distance travelled" value={formatMetres(stats.lara.distance)} />
                    <Tile label="Levels finished" value={formatCount(stats.lara.levels)} />
                    <Tile label="Medipacks used" value={formatCount(stats.lara.medipacks)} />
                    <Tile label="Shots that hit" value={accuracy} note={`of ${formatCount(stats.lara.ammoUsed)} fired`} />
                </div>
                {stats.longestSession !== null && (
                    <p className="record">
                        Longest session: <strong>{formatMinutes(stats.longestSession.minutes)}</strong> of {gameName(stats.longestSession.game)}, on{' '}
                        {formatDay(stats.longestSession.day, true)}.
                    </p>
                )}
            </Card>

            <Card
                wide
                title="When people play"
                note="Time played, by the players' own day of the week and hour."
                table={{
                    columns: ['Day', ...Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))],
                    rows: WEEKDAYS.map((day, weekday) => [day, ...stats.hours.slice(weekday * 24, weekday * 24 + 24).map((n) => (n > 0 ? formatMinutes(n) : '–'))]),
                }}
            >
                {stats.hours.every((n) => n === 0) ? <Empty>No one has played yet.</Empty> : <Heatmap hours={stats.hours} format={formatMinutes} />}
            </Card>

            <div className="grid">
                <DeviceCard title="Screens" tally={stats.devices.screen} group="screen" note="Devices a day." />
                <DeviceCard title="App or browser tab" tally={stats.devices.display} group="display" note="Devices a day." />
                <DeviceCard title="Controls" tally={stats.devices.input} group="input" note="Devices a day that used each; one may use several." />
                <DeviceCard title="Controllers" tally={stats.devices.pad} group="pad" note="By the buttons they wear." />
                <DeviceCard title="Menu looks" tally={stats.devices.look} group="look" note="The look picked in the settings, devices a day." />
                <DeviceCard title="Browsers" tally={stats.devices.browser} group="browser" note="Devices a day." />
                <DeviceCard title="Systems" tally={stats.devices.os} group="os" note="Devices a day." />
                <Card title="Languages" note="Of the browser, devices a day." table={tallyTable(stats.devices.lang, languageName, 'Devices')}>
                    {stats.devices.lang.length === 0 ? <Empty>No one yet.</Empty> : <Bars rows={tallyRows(stats.devices.lang, languageName)} limit={8} />}
                </Card>
                <Card title="Where they came from" note="The site a link was on, for visits that came from one." table={tallyTable(stats.referrers, (key) => key, 'Visits')}>
                    {stats.referrers.length === 0 ? <Empty>No links followed yet.</Empty> : <Bars rows={tallyRows(stats.referrers, (key) => key)} />}
                </Card>
                <Card
                    title="Steam games of logged-in users"
                    note={`Of ${formatCount(totals.players)} logged-in ${totals.players === 1 ? 'user' : 'users'}${stats.steam.private > 0 ? `; ${formatCount(stats.steam.private)} keep their games private` : ''}.`}
                    table={tallyTable(stats.steam.owned, steamProductName, 'Users')}
                >
                    {stats.steam.owned.length === 0 ? <Empty>No one logged in yet.</Empty> : <Bars rows={tallyRows(stats.steam.owned, steamProductName)} />}
                </Card>
            </div>

            <div className="grid">
                <Card title="Data sent" table={tallyTable(stats.bytes, (key) => nameOf('bytes', key), 'Sent', formatBytes)}>
                    {stats.bytes.length === 0 ? <Empty>Nothing sent yet.</Empty> : <Bars rows={tallyRows(stats.bytes, (key) => nameOf('bytes', key), formatBytes)} />}
                    <p className="record">
                        Cloud saves: <strong>{formatCount(stats.cloud.files)}</strong> files ({formatBytes(stats.cloud.bytes)}) for {formatCount(stats.cloud.accounts)}{' '}
                        {stats.cloud.accounts === 1 ? 'player' : 'players'}.
                    </p>
                </Card>
                <Card title="Bots turned away" note="Requests for things this server never had, by what they were after." table={tallyTable(stats.bots, (key) => key, 'Requests')}>
                    {stats.bots.length === 0 ? <Empty>No bots yet.</Empty> : <Bars rows={tallyRows(stats.bots, (key) => key)} />}
                </Card>
            </div>
            {visitorsTotal === 0 && totals.visits === 0 && <Empty>Nothing counted in this range yet.</Empty>}
        </div>
    );
}

function DeviceCard({ title, tally, group, note }: { title: string; tally: Tally[]; group: string; note?: string }) {
    const name = (key: string) => nameOf(group, key);
    return (
        <Card title={title} note={note} table={tallyTable(tally, name, 'Count')}>
            {tally.length === 0 ? <Empty>No one yet.</Empty> : <Bars rows={tallyRows(tally, name)} />}
        </Card>
    );
}

/** The levels shown until the player asks for the rest. */
const FIRST_LEVELS = 5;

function LevelList({ levels }: { levels: LevelStats[] }) {
    const [all, setAll] = useState(false);
    const listId = useId();
    const shown = all ? levels : levels.slice(0, FIRST_LEVELS);
    return (
        <>
            <ol className="levels" id={listId}>
                {shown.map((level, index) => (
                    <li key={level.id}>
                        <span className="levels__rank">{index + 1}</span>
                        {level.cover !== null ? <img className="levels__cover" src={level.cover} alt="" loading="lazy" /> : <span className="levels__cover" />}
                        <span className="levels__text">
                            <a href={`https://trcustoms.org/levels/${level.id}`}>{level.name}</a>
                            <span className="levels__by">
                                {level.authors.length > 0 ? `by ${level.authors.join(', ')}` : ''}
                                {level.game !== null ? ` · TR${level.game}` : ''}
                            </span>
                        </span>
                        <span className="levels__figures">
                            <strong>{formatCount(level.installs)}</strong> installs
                            <span>{formatMinutes(level.minutes)} played</span>
                        </span>
                    </li>
                ))}
            </ol>
            {levels.length > FIRST_LEVELS && (
                <button type="button" className="more" aria-expanded={all} aria-controls={listId} onClick={() => setAll(!all)}>
                    {all ? `Show the top ${FIRST_LEVELS}` : `Show the top ${levels.length}`}
                </button>
            )}
        </>
    );
}
