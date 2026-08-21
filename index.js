import { registerRootComponent } from 'expo';
import App from './mobile/App';

// Entry point for the native TimeTrack shell (Expo / React Native).
// The shell hosts the production TimeTrack web app in a WebView and runs
// native background geofence location monitoring for auto clock-in/out.
registerRootComponent(App);
