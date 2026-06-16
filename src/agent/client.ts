// Phase 20 — AI agent client with Anthropic or Gemini support.
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AgentContext, AgentDecision } from "../types";
import { buildPrompt, SYSTEM_PROMPT } from "./prompts";

type AgentProvider = "anthropic" | "gemini";

const parseDecisionText = (text: string): AgentDecision => {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let parsed: Partial<AgentDecision>;
  try {
    parsed = JSON.parse(cleaned) as Partial<AgentDecision>;
  } catch {
    throw new Error(`Agent returned non-JSON response: ${cleaned.slice(0, 200)}`);
  }

  if (
    typeof parsed.diagnosis !== "string" ||
    !Array.isArray(parsed.recommendedActions) ||
    typeof parsed.newTipLamports !== "number" ||
    typeof parsed.shouldRefreshBlockhash !== "boolean" ||
    typeof parsed.shouldAbandon !== "boolean" ||
    typeof parsed.confidenceScore !== "number" ||
    typeof parsed.reasoningChain !== "string"
  ) {
    throw new Error("Agent response missing required fields");
  }

  return {
    diagnosis: parsed.diagnosis,
    recommendedActions: parsed.recommendedActions,
    newTipLamports: parsed.newTipLamports,
    shouldRefreshBlockhash: parsed.shouldRefreshBlockhash,
    shouldAbandon: parsed.shouldAbandon,
    confidenceScore: parsed.confidenceScore,
    reasoningChain: parsed.reasoningChain,
    decidedAt: Date.now(),
  };
};

export class AgentClient {
  private readonly anthropic?: Anthropic;
  private readonly gemini?: GoogleGenerativeAI;
  private readonly provider: AgentProvider;
  private readonly maxRetries: number;
  private decisionHistory: AgentDecision[] = [];

  constructor(apiKey: string, maxRetries = 3, provider: AgentProvider = "anthropic") {
    this.provider = provider;
    this.maxRetries = maxRetries;

    if (provider === "gemini") {
      this.gemini = new GoogleGenerativeAI(apiKey);
      console.log("[agent] 🤖 AgentClient initialized (model: gemini-2.0-flash)");
    } else {
      this.anthropic = new Anthropic({ apiKey });
      console.log("[agent] 🤖 AgentClient initialized (model: claude-sonnet-4-6)");
    }
  }

  async decide(context: AgentContext): Promise<AgentDecision> {
    const userPrompt = buildPrompt(context);

    let text: string;
    if (this.provider === "gemini") {
      const model = this.gemini!.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await model.generateContent([SYSTEM_PROMPT, userPrompt].join("\n\n"));
      text = result.response.text();
    } else {
      const response = await this.anthropic!.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const raw = response.content[0];
      if (raw.type !== "text") {
        throw new Error("Agent returned non-text response");
      }
      text = raw.text;
    }

    const decision = parseDecisionText(text);
    this.decisionHistory.push(decision);

    console.log(
      `[agent] 🧠 Decision made: ${decision.diagnosis.slice(0, 60)}...`
    );
    console.log(
      `[agent]    action: ${decision.recommendedActions[0] ?? "NONE"}, tip: ${decision.newTipLamports} lamports, confidence: ${decision.confidenceScore}`
    );

    return decision;
  }

  getDecisionHistory(): AgentDecision[] {
    return [...this.decisionHistory];
  }
}

export const createAgentClient = (): AgentClient => {
  const provider = (process.env.AI_PROVIDER ?? "gemini") as AgentProvider;
  const maxRetries = parseInt(process.env.AGENT_MAX_RETRIES ?? "3", 10);

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    return new AgentClient(apiKey, maxRetries, provider);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return new AgentClient(apiKey, maxRetries, provider);
};
