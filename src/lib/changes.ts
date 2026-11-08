// Tells whoever shows the library that what is stored has changed, without
// the storage code having to know who that is; and the cloud sync that
// something worth syncing did.

const target = new EventTarget();

export function announceLibraryChange(): void {
    target.dispatchEvent(new Event('change'));
}

export function onLibraryChange(listener: () => void): () => void {
    target.addEventListener('change', listener);
    return () => target.removeEventListener('change', listener);
}

/** A profile or a custom level came, changed or went: the cloud should hear of it soon. */
export function requestCloudSync(): void {
    target.dispatchEvent(new Event('cloud'));
}

export function onCloudSyncRequest(listener: () => void): () => void {
    target.addEventListener('cloud', listener);
    return () => target.removeEventListener('cloud', listener);
}
