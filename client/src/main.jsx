import React from 'react';
import { createRoot } from 'react-dom/client';
import Router from './Router.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
