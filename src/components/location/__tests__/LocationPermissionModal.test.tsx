/**
 * LocationPermissionModal — denial-recovery UX tests
 * ---------------------------------------------------
 * Inside the native shell the modal must offer the OPEN_NATIVE_SETTINGS
 * deep link (the OS never lets the app re-prompt after "Never"/"Don't
 * allow"); in a plain browser it must keep the text instructions and the
 * reload-retry flow instead.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocationPermissionModal } from '../LocationPermissionModal';

type ShellWindow = Window & { ReactNativeWebView?: { postMessage?: (msg: string) => void } };

describe('LocationPermissionModal', () => {
  afterEach(() => {
    delete (window as ShellWindow).ReactNativeWebView;
  });

  it('offers the device-settings deep link inside the native shell', () => {
    const postMessage = vi.fn();
    (window as ShellWindow).ReactNativeWebView = { postMessage };
    render(
      <LocationPermissionModal
        open
        permission="denied"
        onClose={() => undefined}
        suggestions={['Allow all the time']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Device Settings' }));
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('OPEN_NATIVE_SETTINGS'));
  });

  it('keeps browser recovery instructions without the deep link outside the shell', () => {
    render(
      <LocationPermissionModal
        open
        permission="denied"
        onClose={() => undefined}
        suggestions={['Click the lock icon in the address bar']}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Open Device Settings' })).not.toBeInTheDocument();
    expect(screen.getByText('To enable location access:')).toBeInTheDocument();
    expect(screen.getByText('Click the lock icon in the address bar')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "I've Enabled Location — Retry" }),
    ).toBeInTheDocument();
  });
});
