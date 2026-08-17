import React from 'react';
import ReactDOM from 'react-dom/client';
import { MiniWidget } from './components/mini-widget/MiniWidget';
import './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('widget-root')!).render(
  <React.StrictMode>
    <MiniWidget />
  </React.StrictMode>
);
