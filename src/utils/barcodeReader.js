import sharp from 'sharp';
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from '@zxing/library';

async function tryDecode(data, width, height) {
  try {
    const luminanceSource = new RGBLuminanceSource(data, width, height);
    const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));

    const reader = new MultiFormatReader();
    reader.setHints(new Map([
      [DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.EAN_13,
        BarcodeFormat.CODE_128,
      ]]
    ]));

    const result = reader.decode(binaryBitmap);
    return result.getText();
  } catch {
    return null;
  }
}

export async function decodeBarcodeFromImage(imagePath) {
  try {
    const rotations = [0, 90, 180, 270];
    for (const rotation of rotations) {
      const { data, info } = await sharp(imagePath)
        .rotate(rotation)
        .grayscale()
        .normalize()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const decoded = await tryDecode(data, info.width, info.height);
      if (decoded) {
        console.log(`✅ Barcode found at rotation ${rotation}°: ${decoded}`);
        return decoded;
      }
    }

    console.error('🚫 Barcode not detected in any orientation');
    return null;
  } catch (err) {
    console.error('❌ Error during barcode decoding:', err.message);
    return null;
  }
}
