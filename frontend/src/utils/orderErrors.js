// Turns an order API error into a message that tells the shopper WHAT to fix (defect D6).
// Before: every 422 showed only "Check the customer and cart information."
const FIELD_LABELS = { customerName: 'Full name', email: 'Email address', address: 'Delivery address', items: 'Cart' };
const FIELD_HINTS = {
  customerName: 'enter 2 to 80 characters',
  email: 'enter a valid email address, for example juan@example.com',
  address: 'enter 10 to 300 characters',
  items: 'each item must have a quantity from 1 to 20'
};

export function formatOrderError(error) {
  const fields = Object.keys(error?.details?.fieldErrors || {}).filter((field) => error.details.fieldErrors[field]?.length);
  if (error?.code === 'INVALID_ORDER' && fields.length > 0) {
    return `Please correct: ${fields.map((field) => `${FIELD_LABELS[field] || field} (${FIELD_HINTS[field] || error.details.fieldErrors[field][0]})`).join('; ')}.`;
  }
  return error?.message || 'The order could not be placed.';
}
