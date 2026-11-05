interface Props {
    /** How far along, from 0 to 1, or null when that is not known yet. */
    fraction: number | null;
    label?: string;
}

export function ProgressBar({ fraction, label }: Props) {
    const known = fraction !== null;
    const percent = known ? Math.round(Math.min(1, Math.max(0, fraction)) * 100) : undefined;
    return (
        <div className="progress">
            <div
                className={known ? 'progress__track' : 'progress__track progress__track--busy'}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={label}
            >
                <div className="progress__fill" style={known ? { width: `${percent}%` } : undefined} />
            </div>
            {label !== undefined ? <div className="progress__label">{label}</div> : null}
        </div>
    );
}
