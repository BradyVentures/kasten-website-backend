import OpenAI from 'openai';
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

  // Auto-rotate EXIF, resize keeping aspect ratio
  const image = sharp(originalImagePath).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const isLandscape = width >= height;

  console.log(`Original image: ${width}x${height} (${isLandscape ? 'landscape' : 'portrait'})`);

  // Save as temp PNG for the API
  const tempPath = path.join(__dirname, '..', '..', 'uploads', `temp_${uuidv4()}.png`);
  await image
    .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(tempPath);

  const outputSize = isLandscape ? '1536x1024' : '1024x1536';

  let resultBuffer: Buffer;

  try {
    // Use gpt-image-1.5 with input_fidelity: high for best original preservation
    console.log('Using gpt-image-1.5 with input_fidelity: high...');
    const response = await openai.images.edit({
      model: 'gpt-image-1.5',
      image: [fs.createReadStream(tempPath)] as unknown as Parameters<typeof openai.images.edit>[0]['image'],
      prompt,
      input_fidelity: 'high' as unknown as undefined,
      size: outputSize as '1024x1024',
    });

    const data = response.data?.[0];
    if (data?.b64_json) {
      resultBuffer = Buffer.from(data.b64_json, 'base64');
    } else if (data?.url) {
      const imgRes = await fetch(data.url);
      resultBuffer = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error('No image data in response');
    }
    console.log('gpt-image-1.5 edit successful');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('gpt-image-1.5 failed:', errMsg);

    // Fallback to gpt-image-1
    try {
      console.log('Falling back to gpt-image-1...');
      const response = await openai.images.edit({
        model: 'gpt-image-1',
        image: [fs.createReadStream(tempPath)] as unknown as Parameters<typeof openai.images.edit>[0]['image'],
        prompt,
        size: outputSize as '1024x1024',
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
    } catch (err2: unknown) {
      console.error('gpt-image-1 also failed:', err2 instanceof Error ? err2.message : String(err2));
      throw err2;
    }
  } finally {
    // Cleanup temp file
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  }

  const resultFilename = `${uuidv4()}.png`;
  const resultPath = path.join(__dirname, '..', '..', 'uploads', 'results', resultFilename);
  fs.writeFileSync(resultPath, resultBuffer!);
  return resultFilename;
}
