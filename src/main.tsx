import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/alegreya/wght.css';
import '@fontsource-variable/alegreya/wght-italic.css';
import { installInput } from './input/controller';
import { registerServiceWorker } from './pwa/install';
import { keepScreenOn } from './pwa/wakeLock';
import { trackPixelRatio } from './ui/pixels';
import './styles.css';

// The menu draws with three.js; the play page leaves all of it out, so the
// engine gets the memory.
const HomeScreen = lazy(() => import('./menu/HomeScreen').then((module) => ({ default: module.HomeScreen })));
const PlayScreen = lazy(() => import('./play/PlayScreen').then((module) => ({ default: module.PlayScreen })));

installInput();
registerServiceWorker();
keepScreenOn();
trackPixelRatio();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Suspense fallback={null}>
                <Routes>
                    <Route path="/" element={<HomeScreen />} />
                    <Route path="/play/:profileId" element={<PlayScreen />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </Suspense>
        </BrowserRouter>
    </StrictMode>,
);
