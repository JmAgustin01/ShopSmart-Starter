import { describe, expect, it } from 'vitest';
import { formatOrderError } from './orderErrors.js';

describe('formatOrderError', () => {
  it('names the rejected field instead of a generic message', () => {
    const error = Object.assign(new Error('Check the customer and cart information.'), {
      code: 'INVALID_ORDER', details: { formErrors: [], fieldErrors: { email: ['Invalid email address'] } }
    });
    expect(formatOrderError(error)).toBe('Please correct: Email address (enter a valid email address, for example juan@example.com).');
  });

  it('lists several fields', () => {
    const error = { code: 'INVALID_ORDER', message: 'x', details: { fieldErrors: { customerName: ['Too small'], address: ['Too small'] } } };
    expect(formatOrderError(error)).toContain('Full name');
    expect(formatOrderError(error)).toContain('Delivery address');
  });

  it('keeps the server message for stock and network errors', () => {
    expect(formatOrderError({ code: 'INSUFFICIENT_STOCK', message: 'Only 6 unit(s) of 1080p Webcam are available.' }))
      .toBe('Only 6 unit(s) of 1080p Webcam are available.');
  });
});
