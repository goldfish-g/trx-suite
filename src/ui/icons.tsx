// Small line icons, drawn inline so they work offline and follow the text colour.

import type { ReactNode } from 'react';

function Icon({ children, label }: { children: ReactNode; label?: string }) {
    return (
        <svg
            className="icon"
            viewBox="0 0 24 24"
            aria-hidden={label === undefined}
            aria-label={label}
            role={label === undefined ? undefined : 'img'}
        >
            {children}
        </svg>
    );
}

export const LockIcon = () => (
    <Icon>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
);

export const UserIcon = () => (
    <Icon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Icon>
);

export const GearIcon = () => (
    <Icon>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Icon>
);

export const DownloadIcon = () => (
    <Icon>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </Icon>
);

export const PlayIcon = () => (
    <Icon>
        <path d="M8 5l11 7-11 7z" />
    </Icon>
);

export const ChevronLeft = () => (
    <Icon>
        <path d="M15 5l-7 7 7 7" />
    </Icon>
);

export const ChevronRight = () => (
    <Icon>
        <path d="M9 5l7 7-7 7" />
    </Icon>
);

export const FolderIcon = () => (
    <Icon>
        <path d="M3 7h6l2 2h10v10H3z" />
    </Icon>
);

export const FileIcon = () => (
    <Icon>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
    </Icon>
);

export const InstallIcon = () => (
    <Icon>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M12 7v7M9 11l3 3 3-3" />
    </Icon>
);

export const CheckIcon = () => (
    <Icon>
        <path d="M5 12l5 5 9-10" />
    </Icon>
);

export const TrashIcon = () => (
    <Icon>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
    </Icon>
);

export const PlusIcon = () => (
    <Icon>
        <path d="M12 5v14M5 12h14" />
    </Icon>
);

export const ExternalIcon = () => (
    <Icon>
        <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </Icon>
);

/** A neutral mark for a store, in its initials: logos are their owners' to use. */
export function StoreMark({ provider }: { provider: 'steam' }) {
    return <span className={`store-mark store-mark--${provider}`}>S</span>;
}
