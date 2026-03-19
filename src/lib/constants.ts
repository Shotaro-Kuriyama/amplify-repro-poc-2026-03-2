import type { ProcessingStep } from "@/types";

export const APP_NAME = "AmpliFy";
export const APP_VERSION = "v1.4.0";

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const ACCEPTED_FILE_TYPES = { "application/pdf": [".pdf"] };

export const DEFAULT_SCALE = 100;
export const DEFAULT_FLOOR_HEIGHT = 2.8;
export const DEFAULT_OPACITY = 0.7;

export const PROCESSING_STEPS: ProcessingStep[] = [
  { key: "analyzing", label: "processing.step1", duration: 2000 },
  { key: "detecting", label: "processing.step2", duration: 3000 },
  { key: "generating", label: "processing.step3", duration: 3500 },
  { key: "preparing", label: "processing.step4", duration: 1500 },
];

export const DETECTABLE_ELEMENTS = [
  "elements.wall",
  "elements.door",
  "elements.window",
  "elements.room",
  "elements.sink",
  "elements.shower",
  "elements.bathtub",
  "elements.toilet",
  "elements.bed",
] as const;

export const ORGANIZATION_TYPES = [
  "architect",
  "construction",
  "bim_service",
  "real_estate",
  "government",
  "education",
  "other",
] as const;

export const COUNTRIES = [
  "JP",
  "US",
  "GB",
  "FR",
  "DE",
  "CN",
  "KR",
  "AU",
  "CA",
  "OTHER",
] as const;
