import type {
  SourceRef,
  SourceType,
  SpecCandidate,
  SpecField,
  VerificationStatus,
} from "../types.js";

const SOURCE_PRIORITY: Record<SourceType, number> = {
  manufacturer_official: 0,
  amazon_structured_data: 1,
  amazon_technical_specs: 2,
  amazon_listing_text: 3,
  amazon_title: 4,
  derived: 5,
  unknown: 6,
};

export function makeSource(
  type: SourceType,
  url: string,
  section: string | null,
  retrievedAt: string,
): SourceRef {
  return { type, url, section, retrievedAt };
}

export function fieldFrom<T>(options: {
  value: T | null;
  unit?: string | null;
  source?: SourceRef | null;
  verification?: VerificationStatus;
  qualification?: string | null;
  rawText?: string | null;
}): SpecField<T> {
  const source = options.source ?? null;
  const value = options.value;
  const verification: VerificationStatus =
    value === null ? "unknown" : (options.verification ?? "unverified");
  const candidate: SpecCandidate<T> = {
    value,
    unit: options.unit ?? null,
    source,
    verification,
    qualification: options.qualification ?? null,
    rawText: options.rawText ?? null,
  };
  return {
    value,
    unit: candidate.unit,
    source,
    verification,
    qualification: candidate.qualification,
    rawText: candidate.rawText,
    candidates: [candidate],
  };
}

export function unknownField<T>(qualification: string | null = null): SpecField<T> {
  return {
    value: null,
    unit: null,
    source: null,
    verification: "unknown",
    qualification,
    rawText: null,
    candidates: [],
  };
}

export function notApplicableField<T>(
  qualification: string,
  source: SourceRef | null = null,
  rawText: string | null = null,
): SpecField<T> {
  return {
    value: null,
    unit: null,
    source,
    verification: "not_applicable",
    qualification,
    rawText,
    candidates: [
      {
        value: null,
        unit: null,
        source,
        verification: "not_applicable",
        qualification,
        rawText,
      },
    ],
  };
}

export function candidateFrom<T>(options: {
  value: T;
  unit?: string | null;
  source: SourceRef;
  verification?: VerificationStatus;
  qualification?: string | null;
  rawText?: string | null;
}): SpecCandidate<T> {
  return {
    value: options.value,
    unit: options.unit ?? null,
    source: options.source,
    verification: options.verification ?? "unverified",
    qualification: options.qualification ?? null,
    rawText: options.rawText ?? null,
  };
}

function valueKey(value: unknown): string {
  return JSON.stringify(value);
}

export function conflictingCandidates<T>(candidates: SpecCandidate<T>[]): SpecCandidate<T>[] {
  const known = candidates.filter((candidate) => candidate.value !== null);
  if (known.length <= 1) return [];
  const keys = new Set(known.map((candidate) => valueKey(candidate.value)));
  return keys.size > 1 ? known : [];
}

export function chooseField<T>(
  candidates: SpecCandidate<T>[],
  qualification: string | null = null,
): SpecField<T> {
  const known = candidates.filter((candidate) => candidate.value !== null);
  if (known.length === 0) {
    return unknownField<T>(qualification);
  }

  const sorted = [...known].sort((a, b) => {
    const aPriority = a.source ? SOURCE_PRIORITY[a.source.type] : 99;
    const bPriority = b.source ? SOURCE_PRIORITY[b.source.type] : 99;
    return aPriority - bPriority;
  });
  const selected = sorted[0];
  if (!selected) return unknownField<T>(qualification);

  const conflicts = conflictingCandidates(candidates);
  const conflictNote =
    conflicts.length > 1
      ? `Conflicting values found: ${conflicts
          .map((candidate) => `${String(candidate.value)} (${candidate.source?.type ?? "unknown"})`)
          .join("; ")}.`
      : null;

  const combinedQualification = [qualification, selected.qualification, conflictNote]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    value: selected.value,
    unit: selected.unit,
    source: selected.source,
    verification: selected.verification,
    qualification: combinedQualification || null,
    rawText: selected.rawText,
    candidates: candidates.length > 0 ? candidates : [selected],
  };
}

export function isKnown<T>(field: SpecField<T>): boolean {
  return field.value !== null && field.verification !== "unknown";
}

export function sourceLabel(source: SourceRef | null): string {
  if (!source) return "unknown source";
  return `${source.type}${source.section ? ` (${source.section})` : ""}`;
}
