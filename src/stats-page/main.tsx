import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/alegreya/wght.css';
import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import { StatsPage } from './StatsPage';
import './stats.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <StatsPage />
    </StrictMode>,
);
