import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutoClockStatusNote } from '../AutoClockStatusNote';
import type { ResolvedAutoClockStatus } from '../../../utils/autoClockStatus';

const status: ResolvedAutoClockStatus = {
  kind: 'suppressed',
  tone: 'warning',
  title: 'Auto clock-in paused — you clocked out on site',
  detail: 'Waiting for a confirmed exit.',
};

describe('AutoClockStatusNote', () => {
  it('renders the title and detail inside a status landmark', () => {
    render(<AutoClockStatusNote status={status} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Auto clock-in paused — you clocked out on site')).toBeInTheDocument();
    expect(screen.getByText('Waiting for a confirmed exit.')).toBeInTheDocument();
  });

  it('renders no button when no recovery action is provided', () => {
    render(<AutoClockStatusNote status={status} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the optional recovery action and fires its handler', () => {
    const onClick = vi.fn();
    render(
      <AutoClockStatusNote
        status={{ ...status, kind: 'foreground-only' }}
        action={{ label: 'Open Device Settings', onClick }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Device Settings' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
