import { z } from "zod";

export const aiFindingSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  evidence_event_ids: z.array(z.string().or(z.number())).default([]),
});

export const aiRecommendationSchema = z.object({
  priority: z.number().min(1).max(5),
  action: z.string(),
  reason: z.string(),
  device_specific_command: z.string().optional(),
});

export const aiAnalysisOutputSchema = z.object({
  risk_level: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string(), // Maks 3 kalimat, Bahasa Indonesia
  suspected_attack: z.string().nullable(),
  confidence: z.enum(["rendah", "sedang", "tinggi"]),
  findings: z.array(aiFindingSchema),
  recommendations: z.array(aiRecommendationSchema),
});

export type AIAnalysisOutput = z.infer<typeof aiAnalysisOutputSchema>;
export type AIFinding = z.infer<typeof aiFindingSchema>;
export type AIRecommendation = z.infer<typeof aiRecommendationSchema>;

export interface AIProvider {
  name: string;
  generateText(systemPrompt: string, userPrompt: string): Promise<string>;
}
