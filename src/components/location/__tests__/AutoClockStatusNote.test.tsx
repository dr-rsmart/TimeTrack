import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
