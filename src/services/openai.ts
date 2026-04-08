import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Generischen Prompt aus Kategorie + dynamischen Attributen zusammenbauen
function buildPrompt(categorySlug: string, categoryName: string, preferences: Record<string, string>): string {
  // Attribut-Beschreibungen zusammensetzen (z.B. "RAL 7016 Anthrazitgrau, Funk-Antrieb")
  const attrParts = Object.entries(preferences)
    .filter(([key]) => key !== 'additional')
    .map(([, value]) => value)
    .join(', ');

  const additionalWishes = preferences.additional ? ` Additional requirements: ${preferences.additional}.` : '';

  const baseInstructions = 'Keep the house structure, surroundings, lighting, and perspective exactly the same. Photorealistic result. High quality.';

  if (categorySlug.includes('rollladen') || categorySlug.includes('rolllaeden')) {
    return `Add ${attrParts} roller shutters (Rollläden) to all visible windows on this house. The roller shutters should look professionally installed, matching the architecture.${additionalWishes} ${baseInstructions}`;
  }

  if (categorySlug.includes('terrassendach') || categorySlug.includes('terrassendaecher')) {
    const width = parseInt(preferences.breite || preferences.width || '0', 10);
    const depth = parseInt(preferences.tiefe || preferences.depth || '0', 10);
    const needsMiddlePost = width > 4000;
    const depthInfo = depth > 0 ? ` The roof extends approximately ${(depth / 1000).toFixed(1)} meters from the house wall.` : '';
    const postInfo = needsMiddlePost
      ? ' The roof span exceeds 4 meters, so it must have a center support post (Mittelstütze) in addition to the two front posts.'
      : ' The roof has two front support posts, one on each side.';
    return `Add a heroal CR aluminum terrace roof system (Terrassendach) to the terrace/patio area of this house. The system has slim, modern aluminum profiles in ${attrParts}, with glass roof panels.${postInfo}${depthInfo} It is a premium German-engineered patio cover with clean lines, integrated drainage, and minimal visible hardware. The roof connects flush to the house wall.${additionalWishes} ${baseInstructions}`;
  }

  if (categorySlug.includes('fenster') || categorySlug.includes('tuer') || categorySlug.includes('door') || categorySlug.includes('window')) {
    return `Replace the existing windows and/or front door on this house with new ${attrParts} windows and door. The new elements should look professionally installed with modern hardware.${additionalWishes} ${baseInstructions}`;
  }

  // Fallback: generischer Prompt
  return `Add ${categoryName} (${attrParts}) to this house. The product should look professionally installed, matching the architecture.${additionalWishes} ${baseInstructions}`;
}

export async function generateVisualization(
  originalImagePath: string,
  categorySlug: string,
  categoryName: string,
  preferences: Record<string, string>
): Promise<string> {
  const prompt = buildPrompt(categorySlug, categoryName, preferences);

  console.log('OpenAI prompt:', prompt);

  // Bild zu RGBA PNG konvertieren (dall-e-2 erfordert RGBA)
  const rgbaBuffer = await sharp(originalImagePath)
    .resize(1024, 1024, { fit: 'cover' })
    .ensureAlpha()
    .png()
    .toBuffer();

  const imageFile = await toFile(rgbaBuffer, 'image.png', { type: 'image/png' });

  // Versuche gpt-image-1, Fallback auf dall-e-2
  let resultBuffer: Buffer;

  try {
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
      throw new Error('No image in response');
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('gpt-image-1') || errMsg.includes('invalid')) {
      console.log('gpt-image-1 not available, falling back to dall-e-2');
      const imageFile2 = await toFile(rgbaBuffer, 'image.png', { type: 'image/png' });
      const response = await openai.images.edit({
        model: 'dall-e-2',
        image: imageFile2,
        prompt: prompt.slice(0, 1000), // dall-e-2 hat kürzeres Prompt-Limit
        size: '1024x1024',
      });
      const data = response.data?.[0];
      if (data?.url) {
        const imgRes = await fetch(data.url);
        resultBuffer = Buffer.from(await imgRes.arrayBuffer());
      } else if (data?.b64_json) {
        resultBuffer = Buffer.from(data.b64_json, 'base64');
      } else {
        throw new Error('No image in dall-e-2 response');
      }
    } else {
      throw err;
    }
  }
  const resultFilename = `${uuidv4()}.png`;
  const resultPath = path.join(__dirname, '..', '..', 'uploads', 'results', resultFilename);

  fs.writeFileSync(resultPath, resultBuffer);

  return resultFilename;
}
