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

  const additionalWishes = preferences.additional ? ` Zusätzliche Anforderungen: ${preferences.additional}.` : '';

  const baseInstructions = 'IMPORTANT: Edit the provided photo. Keep the exact same house, same angle, same lighting, same surroundings, same perspective. Only add/change the specified building elements. The result must look like a real photo of the same house, not a different house. Photorealistic result.';

  if (categorySlug.includes('rollladen') || categorySlug.includes('rolllaeden')) {
    return `Edit this photo: Add ${attrParts} roller shutters (Rollläden) to all visible windows on this house. The roller shutters should be professionally installed above each window, partially or fully closed, matching the house architecture and color scheme.${additionalWishes} ${baseInstructions}`;
  }

  if (categorySlug.includes('terrassendach') || categorySlug.includes('terrassendaecher')) {
    const width = parseInt(preferences.breite || preferences.width || '0', 10);
    const depth = parseInt(preferences.tiefe || preferences.depth || '0', 10);
    const needsMiddlePost = width > 4000;
    const depthInfo = depth > 0 ? ` The roof extends approximately ${(depth / 1000).toFixed(1)} meters from the house wall.` : '';
    const postInfo = needsMiddlePost
      ? ' Include a center support post (Mittelstütze) since the span exceeds 4 meters.'
      : '';
    return `Edit this photo: Add a modern aluminum terrace roof (Terrassendach) to the terrace/patio area. The system uses slim aluminum profiles in ${attrParts} with glass roof panels. It connects flush to the house wall with clean lines and minimal hardware.${postInfo}${depthInfo}${additionalWishes} ${baseInstructions}`;
  }

  if (categorySlug.includes('fenster') || categorySlug.includes('tuer') || categorySlug.includes('door') || categorySlug.includes('window')) {
    return `Edit this photo: Replace the existing windows and/or front door with new ${attrParts} windows/doors. The new elements should look professionally installed with modern hardware and clean frames.${additionalWishes} ${baseInstructions}`;
  }

  return `Edit this photo: Add ${categoryName} (${attrParts}) to this house. The product should look professionally installed, matching the existing architecture.${additionalWishes} ${baseInstructions}`;
}

export async function generateVisualization(
  originalImagePath: string,
  categorySlug: string,
  categoryName: string,
  preferences: Record<string, string>
): Promise<string> {
  const prompt = buildPrompt(categorySlug, categoryName, preferences);

  console.log('OpenAI prompt:', prompt);

  // Resize to 1024x1024 PNG with alpha channel
  const rgbaBuffer = await sharp(originalImagePath)
    .resize(1024, 1024, { fit: 'cover' })
    .ensureAlpha()
    .png()
    .toBuffer();

  const imageFile = await toFile(rgbaBuffer, 'image.png', { type: 'image/png' });

  let resultBuffer: Buffer;

  try {
    // gpt-image-1 with images.edit — edits the provided image based on prompt
    console.log('Using gpt-image-1 images.edit...');
    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024',
    });

    const data = response.data?.[0];
    if (data?.b64_json) {
      resultBuffer = Buffer.from(data.b64_json, 'base64');
    } else if (data?.url) {
      const imgRes = await fetch(data.url);
      resultBuffer = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error('No image data in gpt-image-1 response');
    }
    console.log('gpt-image-1 edit successful');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('gpt-image-1 failed:', errMsg);

    // Fallback: Use dall-e-2 with edit
    if (errMsg.includes('model') || errMsg.includes('invalid') || errMsg.includes('not found') || errMsg.includes('does not exist')) {
      console.log('Falling back to dall-e-2...');
      const imageFile2 = await toFile(rgbaBuffer, 'image.png', { type: 'image/png' });
      const response = await openai.images.edit({
        model: 'dall-e-2',
        image: imageFile2,
        prompt: prompt.slice(0, 1000),
        size: '1024x1024',
      });

      const data = response.data?.[0];
      if (data?.url) {
        const imgRes = await fetch(data.url);
        resultBuffer = Buffer.from(await imgRes.arrayBuffer());
      } else if (data?.b64_json) {
        resultBuffer = Buffer.from(data.b64_json, 'base64');
      } else {
        throw new Error('No image data in dall-e-2 response');
      }
      console.log('dall-e-2 edit successful');
    } else {
      throw err;
    }
  }

  const resultFilename = `${uuidv4()}.png`;
  const resultPath = path.join(__dirname, '..', '..', 'uploads', 'results', resultFilename);
  fs.writeFileSync(resultPath, resultBuffer);

  return resultFilename;
}
