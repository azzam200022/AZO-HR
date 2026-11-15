const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 300 * 1024;
const MAX_DIMENSION = 384;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("تعذرت معالجة الصورة"));
    };
    reader.onerror = () => reject(new Error("تعذرت قراءة الصورة"));
    reader.readAsDataURL(blob);
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("تعذر ضغط الصورة"))),
      "image/jpeg",
      quality,
    );
  });
}

/** Shrink employee photos before storing them with the employee record. */
export async function prepareEmployeePhoto(file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("اختر صورة بصيغة JPG أو PNG أو WebP");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("يجب أن يكون حجم الصورة الأصلية أقل من 12 ميغابايت");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("تعذر فتح الصورة المحددة"));
      element.src = objectUrl;
    });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("تعذر تجهيز الصورة");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      const blob = await encodeJpeg(canvas, quality);
      if (blob.size <= MAX_OUTPUT_BYTES) return readAsDataUrl(blob);
    }
    throw new Error("تعذر ضغط الصورة إلى الحجم المطلوب؛ اختر صورة أصغر");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
