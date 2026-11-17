import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { answerQuestion, getLastProviderResult } from '../services/assistant.js';
import { getProviderConfig } from '../services/aiProvider.js';
import { assistantQuestionSchema } from '../validators/schemas.js';
const router = Router();

// Our own limit (protects the provider quota). The JSON body lets the page show a readable message.
const assistantLimiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many questions in a short time. Please wait a minute and try again.' } }
});

router.post('/questions', assistantLimiter, async (request, response, next) => {
  try {
    const parsed = assistantQuestionSchema.safeParse(request.body);
    if (!parsed.success) return response.status(422).json({ error: { code: 'INVALID_QUESTION', message: 'Question must contain between 3 and 300 characters.' } });

    // Week 5: load only public catalog fields from ACTIVE products. Orders and customer data are never read here.
    const catalog = await prisma.product.findMany({
      where: { active: true },
      select: { id: true, name: true, description: true, category: true, price: true, stock: true, active: true },
      orderBy: { price: 'asc' }
    });

    // Retrieval -> optional AI draft -> verification -> rule-based fallback (see services/assistant.js).
    response.json(await answerQuestion({ catalog, question: parsed.data.question }));
  } catch (error) { next(error); }
});

// Setup check: shows whether a key is configured and what the last provider call did.
// It never returns the key itself.
router.get('/status', (_request, response) => {
  const { provider, model, apiKey, timeoutMs } = getProviderConfig();
  response.json({ provider, model, keyConfigured: Boolean(apiKey), timeoutMs, last: getLastProviderResult() });
});

export default router;
