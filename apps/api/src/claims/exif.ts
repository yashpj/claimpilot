import exifr from "exifr";

// Capture date from EXIF, or null. Missing/corrupt EXIF is normal
// (messaging apps strip it) and must never throw.
export async function readCaptureDate(buffer: Buffer): Promise<Date | null> {
  try {
    const exif = (await exifr.parse(buffer, [
      "DateTimeOriginal",
      "CreateDate",
    ])) as { DateTimeOriginal?: Date; CreateDate?: Date } | undefined;
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}
