import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import '@fontsource-variable/alegreya/wght.css';
import '@fontsource-variable/alegreya/wght-italic.css';
import { installInput } from './input/controller';
import { gameHost, setNavigator } from './play/pages';
import { registerServiceWorker } from './pwa/install';
import { keepScreenOn } from './pwa/wakeLock';
import { trackPixelRatio } from './ui/pixels';
import { applyTheme } from './ui/theme';
import './styles.css';

// The menu draws with three.js; a game's frame leaves all of it out, so the
// engine gets the memory.
const HomeScreen = lazy(() => import('./menu/HomeScreen').then((module) => ({ default: module.HomeScreen })));
const GameHost = lazy(() => import('./play/GameHost').then((module) => ({ default: module.GameHost })));
const PlayScreen = lazy(() => import('./play/PlayScreen').then((module) => ({ default: module.PlayScreen })));

/**
 * Whether this page is a game's frame inside the app's page (see
 * play/GameHost.tsx), which plays the game and nothing else.
 */
const framed = gameHost() !== null;

installInput();
if (!framed) registerServiceWorker();
keepScreenOn();
trackPixelRatio();
applyTheme();

/** Lets pages.ts open and close games from outside the screens. */
function NavigationBridge() {
    const navigate = useNavigate();
    useEffect(() => setNavigator(navigate), [navigate]);
    return null;
}

/** A frame that ends up anywhere but a game goes back to the menu. */
function LeaveFrame() {
    useEffect(() => gameHost()?.close(), []);
    return null;
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={null}>
                {framed ? (
                    <Routes>
                        <Route path="/play/:profileId" element={<PlayScreen />} />
                        <Route path="*" element={<LeaveFrame />} />
                    </Routes>
                ) : (
                    <>
                        <NavigationBridge />
                        <Routes>
                            <Route path="/" element={<HomeScreen />} />
                            <Route path="/play/:profileId" element={<GameHost />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </>
                )}
            </Suspense>
        </BrowserRouter>
    </StrictMode>,
);
