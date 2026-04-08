import dotenv from 'dotenv';

dotenv.config();

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const SENDER = {
  name: 'Bauelemente Kasten',
  email: process.env.SENDER_EMAIL || 'info@bauelemente-kasten.de',
};

const OWNER_EMAIL = process.env.CONTACT_EMAIL || 'info@bauelemente-kasten.de';

async function sendEmail(to: { name: string; email: string }, subject: string, htmlContent: string) {
  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: to.email, name: to.name }],
      subject,
      htmlContent,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error: ${res.status} ${body}`);
  }

  return res.json();
}

export async function sendContactConfirmation(to: { name: string; email: string }) {
  return sendEmail(to, 'Ihre Anfrage bei Bauelemente Kasten', `
    <h2>Vielen Dank für Ihre Anfrage, ${to.name}!</h2>
    <p>Wir haben Ihre Nachricht erhalten und werden uns schnellstmöglich bei Ihnen melden.</p>
    <p>Mit freundlichen Grüßen,<br>Olaf Kasten<br>Bauelemente Kasten</p>
    <p style="color: #666; font-size: 12px;">Schillerstr. 19, 19258 Boizenburg | Tel: 038847 54362</p>
  `);
}

export async function sendContactNotification(data: {
  name: string;
  email: string;
  phone?: string;
  message?: string;
  product_interest?: string;
}) {
  return sendEmail(
    { email: OWNER_EMAIL, name: 'Olaf Kasten' },
    `Neue Kontaktanfrage von ${data.name}`,
    `
    <h2>Neue Kontaktanfrage</h2>
    <table style="border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Name:</td><td>${data.name}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">E-Mail:</td><td>${data.email}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Telefon:</td><td>${data.phone || '-'}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Interesse:</td><td>${data.product_interest || '-'}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Nachricht:</td><td>${data.message || '-'}</td></tr>
    </table>
  `);
}

export async function sendVisualizerConfirmation(to: { name: string; email: string }) {
  return sendEmail(to, 'Ihre Visualisierung wird erstellt', `
    <h2>Vielen Dank, ${to.name}!</h2>
    <p>Wir erstellen gerade eine KI-Vorschau basierend auf Ihrem hochgeladenen Foto.
    Sie erhalten in Kürze eine E-Mail mit dem Ergebnis.</p>
    <p>Mit freundlichen Grüßen,<br>Olaf Kasten<br>Bauelemente Kasten</p>
  `);
}

export async function sendVisualizerResult(to: { name: string; email: string }, resultUrl: string) {
  return sendEmail(to, 'Ihre KI-Vorschau ist fertig!', `
    <h2>Ihre Vorschau ist fertig, ${to.name}!</h2>
    <p>Schauen Sie sich an, wie Ihr Zuhause mit unseren Produkten aussehen könnte:</p>
    <p><a href="${resultUrl}" style="display: inline-block; padding: 12px 24px; background-color: #e65644; color: white; text-decoration: none; border-radius: 6px;">Ergebnis ansehen</a></p>
    <p style="color: #666; font-size: 13px;">Dies ist eine KI-generierte Vorschau. Das tatsächliche Ergebnis kann abweichen.</p>
    <p>Möchten Sie eine kostenlose Beratung? Rufen Sie uns an unter <strong>038847 54362</strong>.</p>
    <p>Mit freundlichen Grüßen,<br>Olaf Kasten<br>Bauelemente Kasten</p>
  `);
}

export async function sendVisualizerNotification(data: {
  name: string;
  email: string;
  phone?: string;
  category: string;
  preferences: Record<string, string>;
  message?: string;
}) {
  const prefsHtml = Object.entries(data.preferences)
    .map(([key, val]) => `<tr><td style="padding: 2px 8px 2px 0;">${key}:</td><td>${val}</td></tr>`)
    .join('');

  return sendEmail(
    { email: OWNER_EMAIL, name: 'Olaf Kasten' },
    `Neue Visualisierung von ${data.name} — ${data.category}`,
    `
    <h2>Neue Visualisierungs-Anfrage</h2>
    <table style="border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Name:</td><td>${data.name}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">E-Mail:</td><td>${data.email}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Telefon:</td><td>${data.phone || '-'}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Kategorie:</td><td>${data.category}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Nachricht:</td><td>${data.message || '-'}</td></tr>
    </table>
    <h3>Wünsche:</h3>
    <table>${prefsHtml}</table>
  `);
}

export async function sendDailyLimitWarning(currentCount: number, limit: number) {
  return sendEmail(
    { email: OWNER_EMAIL, name: 'Olaf Kasten' },
    `Visualisierungs-Limit bei ${Math.round((currentCount / limit) * 100)}%`,
    `
    <h2>Tägliches Limit fast erreicht</h2>
    <p>${currentCount} von ${limit} Generierungen heute verbraucht.</p>
    <p>Weitere Anfragen werden in die Warteschlange gestellt und morgen verarbeitet.</p>
  `);
}
