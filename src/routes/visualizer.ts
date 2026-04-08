import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import pool from '../db';
import { upload } from '../services/storage';
import { generateVisualization } from '../services/openai';
import { validate } from '../middleware/validation';
import { visualizerRateLimit } from '../middleware/rateLimiter';
import {
  sendVisualizerConfirmation,
  sendVisualizerNotification,
  sendVisualizerResult,
  sendDailyLimitWarning,
} from '../services/email';

const router = Router();

const DAILY_LIMIT = parseInt(process.env.DAILY_GENERATION_LIMIT || '50', 10);
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const CRM_API_URL = process.env.CRM_API_URL || 'http://localhost:4000/api/v1';

// POST /api/visualizer/upload
router.post('/upload', visualizerRateLimit, (req: Request, res: Response) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Kein Bild hochgeladen' });
    }

    const sessionId = uuidv4();
    const imageUrl = `${BACKEND_URL}/uploads/originals/${req.file.filename}`;

    res.json({
      sessionId,
      imageUrl,
      filename: req.file.filename,
    });
  });
});

const generateSchema = z.object({
  sessionId: z.string().uuid(),
  filename: z.string(),
  category: z.string().min(1),
  categoryName: z.string().min(1),
  preferences: z.record(z.string(), z.string()),
  contact: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional(),
    message: z.string().optional(),
  }),
  gdprConsent: z.literal(true, { message: 'DSGVO-Einwilligung ist erforderlich' }),
  requestQuote: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  depth: z.number().optional(),
});

// POST /api/visualizer/generate
router.post('/generate', validate(generateSchema), async (req: Request, res: Response) => {
  try {
    const { sessionId, filename, category, categoryName, preferences, contact, requestQuote, width, height, depth } = req.body;

    // Check daily limit
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM visualizer_requests
       WHERE created_at >= CURRENT_DATE AND status != 'queued'`
    );
    const todayCount = parseInt(countResult.rows[0].count, 10);

    const isOverLimit = todayCount >= DAILY_LIMIT;
    const status = isOverLimit ? 'queued' : 'processing';

    // Save request to DB
    const dbResult = await pool.query(
      `INSERT INTO visualizer_requests
       (session_id, original_image_url, category, preferences, contact_name, contact_email, contact_phone, message, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [sessionId, filename, category, { ...preferences, requestQuote, width, height, depth }, contact.name, contact.email, contact.phone, contact.message, status]
    );
    const requestId = dbResult.rows[0].id;

    // Send emails (non-blocking)
    Promise.all([
      sendVisualizerConfirmation({ name: contact.name, email: contact.email }),
      sendVisualizerNotification({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        category: categoryName,
        preferences: {
          ...preferences,
          ...(requestQuote ? { 'Angebot gewünscht': 'Ja' } : {}),
          ...(width ? { 'Breite': `${width} mm` } : {}),
          ...(height ? { 'Höhe': `${height} mm` } : {}),
          ...(depth ? { 'Ausfall': `${depth} mm` } : {}),
        },
        message: contact.message,
      }),
    ]).catch(err => console.error('Email error:', err));

    // Warn at 80% limit
    if (todayCount === Math.floor(DAILY_LIMIT * 0.8)) {
      sendDailyLimitWarning(todayCount, DAILY_LIMIT).catch(err => console.error('Limit warning email error:', err));
    }

    // Start AI generation in background (if not over limit)
    if (!isOverLimit) {
      const originalPath = path.join(__dirname, '..', '..', 'uploads', 'originals', filename);
      processGeneration(requestId, originalPath, category, categoryName, preferences, contact, requestQuote, width, height, depth).catch(err =>
        console.error('Generation error:', err)
      );
    }

    res.json({ requestId, status });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

async function processGeneration(
  requestId: string,
  originalPath: string,
  categorySlug: string,
  categoryName: string,
  preferences: Record<string, string>,
  contact: { name: string; email: string; phone?: string },
  requestQuote?: boolean,
  width?: number,
  height?: number,
  depth?: number,
) {
  try {
    // Maße in preferences mergen damit der Prompt sie nutzen kann
    const prefsWithDimensions = {
      ...preferences,
      ...(width ? { breite: String(width) } : {}),
      ...(height ? { hoehe: String(height) } : {}),
      ...(depth ? { tiefe: String(depth) } : {}),
    };
    const resultFilename = await generateVisualization(originalPath, categorySlug, categoryName, prefsWithDimensions);

    await pool.query(
      `UPDATE visualizer_requests SET result_image_url = $1, status = 'completed', completed_at = NOW() WHERE id = $2`,
      [resultFilename, requestId]
    );

    const resultUrl = `${FRONTEND_URL}/visualizer/ergebnis?id=${requestId}`;
    await sendVisualizerResult({ name: contact.name, email: contact.email }, resultUrl);

    // CRM-Angebot erstellen wenn Maße angegeben / Angebot gewünscht
    if (requestQuote) {
      const resultImageUrl = `${BACKEND_URL}/uploads/results/${resultFilename}`;
      const productParts = [categoryName, ...Object.entries(preferences)
        .filter(([k]) => k !== 'additional')
        .map(([, v]) => v)];
      const productName = productParts.join(', ');

      const config: Record<string, unknown> = { ...preferences };
      if (width) config.breite = width;
      if (height) config.hoehe = height;
      if (depth) config.tiefe = depth;

      // Preis über CRM kalkulieren
      let unitPrice = 0;
      try {
        const calcParams = new URLSearchParams();
        if (width) calcParams.set('breite', String(width));
        if (height) calcParams.set('hoehe', String(height));
        if (depth) calcParams.set('tiefe', String(depth));
        const calcRes = await fetch(`${CRM_API_URL}/products/categories/${categorySlug}/calculate?${calcParams}`);
        if (calcRes.ok) {
          const calcData = await calcRes.json() as { unitPrice?: number };
          unitPrice = calcData.unitPrice || 0;
          console.log('Calculated price:', unitPrice, 'EUR');
        }
      } catch (err) {
        console.error('Price calculation failed:', err);
      }

      const dimensionInfo = [
        width ? `Breite: ${width}mm` : '',
        height ? `Höhe: ${height}mm` : '',
        depth ? `Ausfall: ${depth}mm` : '',
      ].filter(Boolean).join(', ');

      try {
        await fetch(`${CRM_API_URL}/offers/from-visualizer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: contact.name,
            customer_email: contact.email,
            customer_phone: contact.phone,
            category_slug: categorySlug,
            product_name: productName,
            configuration: config,
            unit_price: unitPrice,
            visualizer_image_url: resultImageUrl,
            visualizer_request_id: requestId,
            notes: `Visualizer-Anfrage vom ${new Date().toLocaleDateString('de-DE')}. ${dimensionInfo || 'Keine Maße angegeben.'}`,
          }),
        });
        console.log('CRM offer created for visualizer request', requestId);
      } catch (err) {
        console.error('Failed to create CRM offer:', err);
      }
    }
  } catch (error) {
    console.error('AI generation failed:', error);
    await pool.query(
      `UPDATE visualizer_requests SET status = 'failed' WHERE id = $1`,
      [requestId]
    );
  }
}

// GET /api/visualizer/status/:id
router.get('/status/:id', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, status, result_image_url, created_at, completed_at FROM visualizer_requests WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      status: row.status,
      resultImageUrl: row.result_image_url
        ? `${BACKEND_URL}/uploads/results/${row.result_image_url}`
        : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

export default router;
