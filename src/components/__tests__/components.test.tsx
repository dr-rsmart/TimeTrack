import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  Button,
  Card,
  Badge,
  EmptyState,
  Spinner,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
} from '../ui';
import BrandLogo from '../layout/BrandLogo';
import { ErrorBoundary } from '../ErrorBoundary';

function Throwing(): never {
  throw new Error('boom');
}

describe('ui primitives', () => {
  it('renders a Button and fires clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: /save/i });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders Card structure', () => {
    render(
      <Card>
        <p>content</p>
      </Card>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('renders a Badge with text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders EmptyState message', () => {
    render(<EmptyState message="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('renders a Spinner', () => {
    const { container } = render(<Spinner />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a Table with header/rows', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alice</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('BrandLogo', () => {
  it('renders the brand mark and links home', () => {
    render(
      <MemoryRouter>
        <BrandLogo />
      </MemoryRouter>,
    );
    expect(screen.getByAltText('TimeTrack Logo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /timetrack home/i })).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('catches render errors and shows the fallback', () => {
    // React logs the caught error to console.error — silence it for the test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Throwing />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    spy.mockRestore();
  });
});
