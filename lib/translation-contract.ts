export type TaskStatus =
  | "draft"
  | "processing"
  | "review"
  | "pending_approval"
  | "approved"
  | "exported";

export type TranslationRequest = {
  taskId: string;
  sourceLanguage: "ja";
  targetLanguage: "zh-CN";
  blocks: Array<{
    id: string;
    text: string;
    page: number;
    context?: string;
  }>;
  fixedTerms: Array<{
    source: string;
    target: string;
  }>;
  protectedTerms: string[];
};

export type TranslationResponse = {
  taskId: string;
  provider: string;
  blocks: Array<{
    id: string;
    translation: string;
    confidence: number;
    matchedTerms: string[];
    reviewReasons: string[];
  }>;
};

export interface TranslationProvider {
  name: string;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}
