// Tells whoever shows the library that what is stored has changed, without
// the storage code having to know who that is.

const target = new EventTarget();

export function announceLibraryChange(): void {
    target.dispatchEvent(new Event('change'));
}

export function onLibraryChange(listener: () => void): () => void {
    target.addEventListener('change', listener);
    return () => target.removeEventListener('change', listener);
}
