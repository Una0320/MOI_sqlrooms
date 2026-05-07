import {ThemeProvider} from '@sqlrooms/ui';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Room} from './room';
import './index.css';
import { DuckDBProvider } from './duckdb/DuckDBContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="sqlrooms-ui-theme">
      <DuckDBProvider>
        <Room />
      </DuckDBProvider>
    </ThemeProvider>
  </StrictMode>,
);
