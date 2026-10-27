export function EditIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m12.5 3.5 4 4M3 17l4.5-1 9-9a2.8 2.8 0 0 0-4-4l-9 9L3 17Z" />
        </svg>
    );
}

export function TrashIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M3 5.5h14M7 5.5v-2h6v2M4.5 5.5l1 11h9l1-11M8 8.5v5.5M12 8.5v5.5" />
        </svg>
    );
}

export function ExternalLinkIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M11 3h6v6M17 3l-8 8M8 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4" />
        </svg>
    );
}

export function ChevronDownIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m6 8 4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function ChevronRightIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m8 6 4 4-4 4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m6 6 8 8M14 6l-8 8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function FolderIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <FolderOutline />
        </svg>
    );
}

export function HomeIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path
                d="m2.75 9.25 7.25-6 7.25 6M4.75 7.6v8.65h10.5V7.6M8 16.25v-5h4v5"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function FolderUpIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <FolderOutline />
            <path
                d="m7.5 12 2.5-2.5 2.5 2.5M10 9.5v4.25"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function FolderOutline() {
    return (
        <path
            d="M2.5 5.5A1.5 1.5 0 0 1 4 4h4l1.5 2H16A1.5 1.5 0 0 1 17.5 7.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z"
            strokeWidth="1.5"
            strokeLinejoin="round"
        />
    );
}

export function GridIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="3" y="3" width="5" height="5" rx="1" strokeWidth="1.5" />
            <rect x="12" y="3" width="5" height="5" rx="1" strokeWidth="1.5" />
            <rect x="3" y="12" width="5" height="5" rx="1" strokeWidth="1.5" />
            <rect x="12" y="12" width="5" height="5" rx="1" strokeWidth="1.5" />
        </svg>
    );
}

export function OptionsIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M4.5 5.5h.01M4.5 10h.01M4.5 14.5h.01" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M8 5.5h9M8 10h9M8 14.5h9" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

export function MoreIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="10" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="16" cy="10" r="1.5" />
        </svg>
    );
}

export function FilterIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <path d="M3 5h14M5.5 10h9M8 15h4" />
        </svg>
    );
}

export function SortIcon() {
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M6 15V4m-3 3 3-3 3 3M12 5h5M12 10h3.5M12 15h2" />
        </svg>
    );
}

export function SearchIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5" strokeWidth="1.6" />
            <path d="m12.25 12.25 4 4" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

export function SettingsIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path
                d="M8.7 2.8h2.6l.6 2a6 6 0 0 1 1.2.7l2-.5 1.3 2.2-1.5 1.5a6 6 0 0 1 0 1.4l1.5 1.5-1.3 2.2-2-.5a6 6 0 0 1-1.2.7l-.6 2H8.7l-.6-2a6 6 0 0 1-1.2-.7l-2 .5-1.3-2.2 1.5-1.5a6 6 0 0 1 0-1.4L3.6 7.2 4.9 5l2 .5a6 6 0 0 1 1.2-.7l.6-2Z"
                strokeWidth="1.35"
                strokeLinejoin="round"
            />
            <circle cx="10" cy="9.4" r="2.25" strokeWidth="1.35" />
        </svg>
    );
}

export function SyncIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path
                d="M4 6.75h11.5M13 4.25l2.5 2.5L13 9.25"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M16 13.25H4.5M7 10.75l-2.5 2.5L7 15.75"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function TableIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="2.5" y="3" width="15" height="14" rx="1.5" strokeWidth="1.5" />
            <path d="M2.5 8h15M2.5 12.5h15M7.5 3v14" strokeWidth="1.5" />
        </svg>
    );
}

export function CheckIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function CopyIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5" strokeWidth="1.5" />
            <path
                d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"
                strokeWidth="1.5"
            />
        </svg>
    );
}

export function PlusIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M10 4.5v11M4.5 10h11" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
