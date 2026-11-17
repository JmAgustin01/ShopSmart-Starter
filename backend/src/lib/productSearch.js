// backend/src/lib/productSearch.js
// Builds the Prisma "where" object for GET /api/products.
// It is kept in its own file so the search rule can be tested without a database.

export function buildProductWhere(search) {
  // The query value can be missing, or an array if the URL repeats ?search=.
  // Only a plain string is used; anything else is treated as "no search".
  const term = typeof search === 'string' ? search.trim() : '';

  // Only active products are ever returned, with or without a search term.
  if (!term) return { active: true };

  // A product matches when the term is in the name OR in the description.
  // mode: 'insensitive' ignores upper/lower case ("Keyboard" = "keyboard").
  // The active rule stays outside the OR, so inactive products never appear.
  return {
    active: true,
    OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } }
    ]
  };
}
