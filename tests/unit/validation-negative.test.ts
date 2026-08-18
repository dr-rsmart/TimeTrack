import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  changePasswordSchema,
  createEmployeeSchema,
  createShiftSchema,
  clockInSchema,
  clockOutSchema,
} from '../../server/src/validation.js';

describe('Validation Schema Negative & Edge Case Tests', () => {
  describe('loginSchema', () => {
    it('rejects empty or invalid email', () => {
      const result = loginSchema.safeParse({ email: 'not-an-email', password: 'Password123' });
      expect(result.success).toBe(false);
    });

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({ email: 'valid@example.com', password: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('changePasswordSchema', () => {
    it('rejects password shorter than 8 characters', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'Password123',
        newPassword: 'Short1',
      });
      expect(result.success).toBe(false);
    });

    it('rejects password without number or uppercase letter', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'Password123',
        newPassword: 'lowercaseonlypassword',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createEmployeeSchema', () => {
    it('rejects invalid role', () => {
      const result = createEmployeeSchema.safeParse({
        firstName: 'John',
        surname: 'Doe',
        email: 'john@example.com',
        role: 'super_admin_invalid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing surname or email', () => {
      const result = createEmployeeSchema.safeParse({
        firstName: 'John',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createShiftSchema', () => {
    it('rejects invalid date format (non YYYY-MM-DD)', () => {
      const result = createShiftSchema.safeParse({
        date: '18-08-2026',
        startTime: '08:00',
        endTime: '17:00',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid time format', () => {
      const result = createShiftSchema.safeParse({
        date: '2026-08-18',
        startTime: '8:00 AM', // not HH:MM
        endTime: '17:00',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('clockInSchema', () => {
    it('rejects out of range latitude (> 90 or < -90)', () => {
      const result = clockInSchema.safeParse({
        latitude: 95.0,
        longitude: 18.0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects out of range longitude (> 180 or < -180)', () => {
      const result = clockInSchema.safeParse({
        latitude: -33.9,
        longitude: 195.0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('clockOutSchema', () => {
    it('rejects negative break minutes', () => {
      const result = clockOutSchema.safeParse({
        breakMinutes: -15,
      });
      expect(result.success).toBe(false);
    });

    it('rejects excessively large break minutes (> 1440 mins)', () => {
      const result = clockOutSchema.safeParse({
        breakMinutes: 2000,
      });
      expect(result.success).toBe(false);
    });
  });
});
