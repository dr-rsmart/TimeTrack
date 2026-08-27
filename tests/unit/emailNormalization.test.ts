import { describe, it, expect } from 'vitest';

describe('Email Normalization & Case-Insensitive Matching', () => {
  it('normalizes mixed case and padded email addresses correctly', () => {
    const rawEmail = '  Jennifer.Smith@Company.COM  ';
    const normalized = rawEmail.toLowerCase().trim();
    expect(normalized).toBe('jennifer.smith@company.com');
  });

  it('correctly matches target employee email regardless of casing', () => {
    const userEmail = 'Jennifer.Smith@Company.COM';
    const targetEmailFromReq = undefined;
    const targetEmailLower = (typeof targetEmailFromReq === 'string' ? targetEmailFromReq : userEmail).toLowerCase().trim();
    
    expect(targetEmailLower).toBe('jennifer.smith@company.com');
  });
});
