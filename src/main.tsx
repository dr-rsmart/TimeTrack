import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/index.css'

// Apply dark mode based on system preference
const applyDarkMode = (e) => {
  document.documentElement.classList.toggle('dark', e.matches);
};
const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
applyDarkMode(darkModeQuery);
darkModeQuery.addEventListener('change', applyDarkMode);

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)