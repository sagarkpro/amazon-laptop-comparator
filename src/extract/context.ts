import type { Issue, PageSnapshot, SourceRef, SourceType } from "../types.js";

export class ExtractionContext {
  readonly warnings: Issue[] = [];

  constructor(readonly snapshot: PageSnapshot) {}

  warn(code: string, message: string, detail?: string): void {
    this.warnings.push({ code, message, detail });
  }

  source(type: SourceType, section: string | null = null): SourceRef {
    return {
      type,
      url: this.snapshot.canonicalUrl ?? this.snapshot.finalUrl,
      section,
      retrievedAt: this.snapshot.extractedAt,
    };
  }

  sourceForSection(section: string, type: SourceType): SourceRef {
    return this.source(type, section);
  }
}
