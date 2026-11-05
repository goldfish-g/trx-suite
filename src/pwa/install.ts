// Offering to install the app: the browser's own prompt where there is one
// (Chromium), instructions where there is not (iOS Safari), nothing once
// installed.

import { create } from 'zustand';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
    /** How the app can be installed here, if it can. */
    mode: 'prompt' | 'ios' | 'installed' | 'none';
    /** A new version is waiting; reloading starts it. */
    updateReady: boolean;
}

function isStandalone(): boolean {
    return (
        matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

function isIos(): boolean {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export const useInstall = create<InstallState>(() => ({
    mode: isStandalone() ? 'installed' : isIos() ? 'ios' : 'none',
    updateReady: false,
}));

let deferred: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    useInstall.setState({ mode: 'prompt' });
});

window.addEventListener('appinstalled', () => {
    deferred = null;
    useInstall.setState({ mode: 'installed' });
});

export async function promptInstall(): Promise<void> {
    if (deferred === null) return;
    const event = deferred;
    deferred = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    useInstall.setState({ mode: outcome === 'accepted' ? 'installed' : 'none' });
}

let waiting: ServiceWorker | null = null;

/** Registers the service worker, which keeps the app working offline. */
export function registerServiceWorker(): void {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            const noteWaiting = () => {
                if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
                    waiting = registration.waiting;
                    useInstall.setState({ updateReady: true });
                }
            };
            noteWaiting();
            registration.addEventListener('updatefound', () => {
                registration.installing?.addEventListener('statechange', noteWaiting);
            });
            // Check for a new version now and then while the app stays open.
            setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
        } catch (error) {
            console.warn('[pwa] the service worker could not be registered:', error);
        }
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || waiting === null) return;
        reloading = true;
        location.reload();
    });
}

/** Starts the waiting version; the page reloads once it takes over. */
export function applyUpdate(): void {
    waiting?.postMessage({ type: 'skip-waiting' });
}
