import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { orderSchema } from '../validators/schemas.js';
import { canReadOrder } from '../lib/auth.js';
import { attachUser, requireUser } from '../middleware/session.js';

// Shapes an order for JSON: Decimal prices become numbers and the owner id is not sent.
function orderView(order) {
  const rest = { ...order };
  delete rest.userId;
  return {
    ...rest, total: Number(order.total),
    items: order.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice), productName: item.product?.name, product: undefined }))
  };
}

export function createOrdersRouter(db = prisma) {
  const router = Router();
  // Every order route needs a signed-in customer (guest -> 401). Checked here on the server.
  router.use(attachUser(db), requireUser);

  // List the signed-in customer's own orders, newest first.
  router.get('/', async (request, response, next) => {
    try {
      const orders = await db.order.findMany({ where: { userId: request.user.id }, orderBy: { id: 'desc' }, include: { items: { include: { product: { select: { name: true } } } } } });
      response.json(orders.map(orderView));
    } catch (error) { next(error); }
  });

  // Read one order. Another customer's order is refused with 403, even if the id is guessed.
  router.get('/:orderId', async (request, response, next) => {
    try {
      const orderId = Number(request.params.orderId);
      if (!Number.isInteger(orderId) || orderId < 1) return response.status(400).json({ error: { code: 'INVALID_ORDER_ID', message: 'Order id must be a positive whole number.' } });
      const order = await db.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: { select: { name: true } } } } } });
      if (!order) return response.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } });
      if (!canReadOrder(request.user, order)) return response.status(403).json({ error: { code: 'ORDER_FORBIDDEN', message: 'You can only view your own orders.' } });
      response.json(orderView(order));
    } catch (error) { next(error); }
  });

  router.post('/', async (request, response, next) => {
    try {
      const parsed = orderSchema.safeParse(request.body);
      if (!parsed.success) return response.status(422).json({ error: { code: 'INVALID_ORDER', message: 'Check the customer and cart information.', details: parsed.error.flatten() } });

      const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
      const products = await db.product.findMany({ where: { id: { in: productIds }, active: true } });
      if (products.length !== productIds.length) return response.status(422).json({ error: { code: 'PRODUCT_UNAVAILABLE', message: 'One or more products are unavailable.' } });

      const productMap = new Map(products.map((product) => [product.id, product]));
      const normalizedItems = parsed.data.items.map((item) => ({ ...item, product: productMap.get(item.productId) }));
      const unavailable = normalizedItems.find((item) => item.quantity > item.product.stock);
      if (unavailable) return response.status(409).json({ error: { code: 'INSUFFICIENT_STOCK', message: `Only ${unavailable.product.stock} unit(s) of ${unavailable.product.name} are available.` } });

      const total = normalizedItems.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.product.price).times(item.quantity)), new Prisma.Decimal(0));
      const order = await db.$transaction(async (transaction) => {
        for (const item of normalizedItems) {
          const updated = await transaction.product.updateMany({
            where: { id: item.productId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } }
          });
          if (updated.count !== 1) throw Object.assign(new Error('Stock changed while placing the order.'), { status: 409, code: 'STOCK_CHANGED' });
        }
        return transaction.order.create({
          data: {
            userId: request.user.id,
            customerName: parsed.data.customerName, email: parsed.data.email, address: parsed.data.address, total,
            items: { create: normalizedItems.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.product.price })) }
          },
          include: { items: true }
        });
      });
      response.status(201).json(orderView(order));
    } catch (error) { next(error); }
  });

  return router;
}

export default createOrdersRouter;
