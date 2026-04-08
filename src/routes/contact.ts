import { Router } from 'express';
import { z } from 'zod';
import pool from '../db';
import { validate } from '../middleware/validation';
import { contactRateLimit } from '../middleware/rateLimiter';
import { sendContactConfirmation, sendContactNotification } from '../services/email';

const router = Router();

const contactSchema = z.object({
  name: z.string().min(2, 'Name ist erforderlich'),
  email: z.string().email('Ungültige E-Mail-Adresse'),
  phone: z.string().optional(),
  message: z.string().optional(),
  product_interest: z.string().optional(),
});

router.post('/', contactRateLimit, validate(contactSchema), async (req, res) => {
  try {
    const { name, email, phone, message, product_interest } = req.body;

    const result = await pool.query(
      `INSERT INTO contact_submissions (name, email, phone, message, product_interest)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, email, phone, message, product_interest]
    );

    // Send emails (don't block response)
    Promise.all([
      sendContactConfirmation({ name, email }),
      sendContactNotification({ name, email, phone, message, product_interest }),
    ]).catch(err => console.error('Email error:', err));

    res.status(201).json({ id: result.rows[0].id, message: 'Anfrage erfolgreich gesendet' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});

export default router;
