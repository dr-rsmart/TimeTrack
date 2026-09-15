/**
 * Shared setup for jsdom (web) component tests.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// The web project runs with `globals: false`, so @testing-library/react
// cannot self-register its auto-cleanup — unmount rendered trees explicitly
// between tests or queries will find duplicate elements.
afterEach(() => {
  cleanup();
});
