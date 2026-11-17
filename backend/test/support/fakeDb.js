// In-memory stand-in for the parts of Prisma used by auth and order routes.
// Lets the access-control tests run inside `npm run check` without a live database.
export function createFakeDb({ products = [] } = {}) {
  const data = { users: [], sessions: [], orders: [], products: products.map((product) => ({ active: true, ...product })) };
  let nextId = { user: 1, session: 1, order: 1, item: 1 };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    if (value && typeof value === 'object' && 'gte' in value) return row[key] >= value.gte;
    return row[key] === value;
  });
  const withProducts = (order) => ({ ...order, items: order.items.map((item) => ({ ...item, product: { name: data.products.find((p) => p.id === item.productId)?.name } })) });

  const db = {
    data,
    user: {
      findUnique: async ({ where }) => data.users.find((u) => matches(u, where)) || null,
      create: async ({ data: row }) => {
        if (data.users.some((u) => u.email === row.email)) throw Object.assign(new Error('Unique'), { code: 'P2002' });
        const user = { id: nextId.user++, createdAt: new Date(), ...row }; data.users.push(user); return user;
      }
    },
    session: {
      create: async ({ data: row }) => { const session = { id: nextId.session++, ...row }; data.sessions.push(session); return session; },
      findUnique: async ({ where }) => {
        const session = data.sessions.find((s) => matches(s, where));
        return session ? { ...session, user: data.users.find((u) => u.id === session.userId) } : null;
      },
      deleteMany: async ({ where }) => { const before = data.sessions.length; data.sessions = data.sessions.filter((s) => !matches(s, where)); return { count: before - data.sessions.length }; }
    },
    product: {
      findMany: async ({ where }) => data.products.filter((p) => matches(p, where)),
      updateMany: async ({ where, data: change }) => {
        const product = data.products.find((p) => matches(p, where));
        if (!product) return { count: 0 };
        product.stock -= change.stock.decrement; return { count: 1 };
      }
    },
    order: {
      create: async ({ data: row }) => {
        const order = { id: nextId.order++, status: 'PENDING', createdAt: new Date(), ...row, items: row.items.create.map((item) => ({ id: nextId.item++, ...item })) };
        order.items.forEach((item) => { item.orderId = order.id; });
        data.orders.push(order); return order;
      },
      findMany: async ({ where }) => data.orders.filter((o) => matches(o, where)).sort((a, b) => b.id - a.id).map(withProducts),
      findUnique: async ({ where }) => { const order = data.orders.find((o) => o.id === where.id); return order ? withProducts(order) : null; }
    },
    $transaction: async (work) => work(db)
  };
  return db;
}
