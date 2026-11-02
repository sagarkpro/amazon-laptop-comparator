import type { ExtractedProduct, PageSnapshot } from "../types.js";
import { ExtractionContext } from "./context.js";
import { extractIdentity } from "./product.js";
import { extractGpu } from "./gpu.js";
import { extractCpu } from "./cpu.js";
import { extractMemory } from "./memory.js";
import { extractStorage, extractDisplay, extractWeight } from "./physical.js";
import { extractPrice } from "./price.js";

export function extractAmazonProduct(snapshot: PageSnapshot): {
  product: ExtractedProduct;
  context: ExtractionContext;
} {
  const context = new ExtractionContext(snapshot);
  const identity = extractIdentity(snapshot, context);

  const gpu = extractGpu(snapshot, context, identity.title);
  const cpu = extractCpu(snapshot, context, identity.title);
  const memory = extractMemory(snapshot, context, identity.title);
  const storage = extractStorage(snapshot, context, identity.title);
  const display = extractDisplay(snapshot, context, identity.title);
  const weight = extractWeight(snapshot, context, identity.title);
  const price = extractPrice(snapshot, context);

  return {
    product: {
      title: identity.title,
      imageUrl: identity.imageUrl,
      titleSource: identity.titleSource,
      asin: identity.asin,
      canonicalUrl: identity.canonicalUrl,
      brand: identity.brand,
      model: identity.model,
      availability: identity.availability,
      gpu,
      cpu,
      memory,
      storage,
      display,
      weight,
      price,
    },
    context,
  };
}
