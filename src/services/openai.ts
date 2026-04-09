import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPrompt(categorySlug: string, categoryName: string, preferences: Record<string, string>): string {
  const attrParts = Object.entries(preferences)
    .filter(([key]) => key !== 'additional')
    .map(([, value]) => value)
    .join(', ');

  const additionalWishes = preferences.additional ? ` Zusätzliche Anforderungen des Kunden: ${preferences.additional}.` : '';

  if (categorySlug.includes('rollladen') || categorySlug.includes('rolllaeden')) {
    return `Add ${attrParts} roller shutters (Rollläden) to all visible windows. The shutters should be mounted above each window, partially closed, matching the house style.${additionalWishes} Change nothing else about the photo.`;
  }

  if (categorySlug.includes('terrassendach') || categorySlug.includes('terrassendaecher')) {
    const width = parseInt(preferences.breite || preferences.width || '0', 10);
    const depth = parseInt(preferences.tiefe || preferences.depth || '0', 10);
    const needsMiddlePost = width > 4000;
    const depthInfo = depth > 0 ? ` Extending ${(depth / 1000).toFixed(1)}m from the wall.` : '';
    const postInfo = needsMiddlePost ? ' With center support post.' : '';
    return `Add a modern aluminum terrace roof to the patio area. Slim ${attrParts} profiles with glass panels, flush wall connection.${postInfo}${depthInfo}${additionalWishes} Change nothing else about the photo.`;
  }

  if (categorySlug.includes('fenster') || categorySlug.includes('tuer') || categorySlug.includes('door') || categorySlug.includes('window')) {
    return `Replace the existing windows and/or front door with new ${attrParts} windows/doors. Modern frames and hardware.${additionalWishes} Change nothing else about the photo.`;
  }

  return `Add ${categoryName} (${attrParts}) to this house. Professionally installed.${additionalWishes} Change nothing else about the photo.`;
}

export async function generateVisualization(
  originalImagePath: string,
  categorySlug: string,
  categoryName: string,
  preferences: Record<string, string>
): Promise<string> {
  const prompt = buildPrompt(categorySlug, categoryName, preferences);

  console.log('OpenAI prompt:', prompt);

  // Resize image — keep aspect ratio, max 1536px for quality
  const rgbaBuffer = await sharp(originalImagePath)
    .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();

  const imageFile = await toFile(rgbaBuffer, 'image.png', { type: 'image/png' });

  let resultBuffer: Buffer;

  // Try gpt-image-1.5 first (best at preserving originals), then gpt-image-1, then dall-e-2
  const models = ['gpt-image-1.5', 'gpt-image-1', 'dall-e-2'];

  for (const model of models) {
    try {
      console.log(`Trying ${model} images.edit...`);
      const currentImageFile = await toFile(rgbaBuffer, 'image.png', { type: 'image/png' });

      const response = await openai.images.edit({
        model,
        image: currentImageFile,
        prompt: model === 'dall-e-2' ? prompt.slice(0, 1000) : prompt,
        size: '1024x1024',
      });

      const data = response.data?.[0];
      if (data?.b64_json) {
        resultBuffer = Buffer.from(data.b64_json, 'base64');
      } else if (data?.url) {
        const imgRes = await fetch(data.url);
        resultBuffer = Buffer.from(await imgRes.arrayBuffer());
      } else {
        throw new Error(`No image data in ${model} response`);
      }

      console.log(`${model} edit successful`);

      const resultFilename = `${uuidv4()}.png`;
      const resultPath = path.join(__dirname, '..', '..', 'uploads', 'results', resultFilename);
      fs.writeFileSync(resultPath, resultBuffer!);
      return resultFilename;

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${model} failed:`, errMsg);

      // If it's a model-not-found error, try next model
      if (errMsg.includes('model') || errMsg.includes('not found') || errMsg.includes('does not exist') || errMsg.includes('invalid')) {
        continue;
      }
      // For other errors (auth, rate limit, etc.), throw immediately
      throw err;
    }
  }

  throw new Error('All image generation models failed');
}
