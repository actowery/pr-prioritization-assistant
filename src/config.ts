import { DEFAULT_CONFIG, DEFAULT_ISSUE_THRESHOLDS, DEFAULT_ISSUE_WEIGHTS } from "./constants.js";
import {
  CliOptions,
  CodeJamThresholds,
  ConfigBundle,
  IssueCliOptions,
  IssueScoringWeights,
  LabelRules,
  LowHangingThresholds,
  ScoringWeights,
} from "./types.js";
import { readJsonFile } from "./utils.js";

type AffiliationInputValue = string | string[];
type AffiliationInput = Record<string, AffiliationInputValue>;

function mergeWeights(
  base: ScoringWeights,
  override?: Partial<ScoringWeights>,
): ScoringWeights {
  return { ...base, ...override };
}

function mergeLowHanging(
  base: LowHangingThresholds,
  override?: Partial<LowHangingThresholds>,
): LowHangingThresholds {
  return { ...base, ...override };
}

function mergeLabelRules(base: LabelRules, override?: Partial<LabelRules>): LabelRules {
  return {
    businessLabels: override?.businessLabels ?? base.businessLabels,
    unblockLabels: override?.unblockLabels ?? base.unblockLabels,
    maintenanceLabels: override?.maintenanceLabels ?? base.maintenanceLabels,
    quickWinLabels: override?.quickWinLabels ?? base.quickWinLabels,
    customerLabels: override?.customerLabels ?? base.customerLabels,
  };
}

function mergeCodeJamThresholds(
  base: CodeJamThresholds,
  override?: Partial<CodeJamThresholds>,
): CodeJamThresholds {
  return { ...base, ...override };
}

async function loadOptionalJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function splitAffiliationMembers(raw: string): string[] {
  return raw
    .split(/[\r\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function appendAffiliation(
  target: Record<string, string[]>,
  user: string,
  category: string,
): void {
  const normalizedUser = user.trim();
  const normalizedCategory = category.trim();

  if (!normalizedUser || !normalizedCategory) {
    return;
  }

  const existing = target[normalizedUser] ?? [];
  if (!existing.includes(normalizedCategory)) {
    existing.push(normalizedCategory);
  }
  target[normalizedUser] = existing;
}

export function normalizeAffiliationMap(input?: AffiliationInput): Record<string, string> {
  if (!input) {
    return {};
  }

  const collected: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const member of value) {
        appendAffiliation(collected, member, key);
      }
      continue;
    }

    const looksGrouped =
      value.includes(",") ||
      value.includes("\n") ||
      /\s{2,}/.test(value);

    if (looksGrouped) {
      for (const member of splitAffiliationMembers(value)) {
        appendAffiliation(collected, member, key);
      }
      continue;
    }

    appendAffiliation(collected, key, value);
  }

  return Object.fromEntries(
    Object.entries(collected).map(([user, categories]) => [user, categories.join(", ")]),
  );
}

export async function loadIssueConfig(options: IssueCliOptions): Promise<ConfigBundle> {
  const config: ConfigBundle = {
    weights: { ...DEFAULT_CONFIG.weights },
    repoWeights: { ...DEFAULT_CONFIG.repoWeights },
    affiliationMap: { ...DEFAULT_CONFIG.affiliationMap },
    lowHangingThresholds: { ...DEFAULT_CONFIG.lowHangingThresholds },
    labelRules: { ...DEFAULT_CONFIG.labelRules },
    codeJamThresholds: { ...DEFAULT_CONFIG.codeJamThresholds },
    issueWeights: { ...DEFAULT_ISSUE_WEIGHTS },
    issueThresholds: { ...DEFAULT_ISSUE_THRESHOLDS },
  };

  if (options.repoBusinessWeight) {
    const repoWeights = await loadOptionalJsonFile<Record<string, number>>(options.repoBusinessWeight);
    config.repoWeights = { ...config.repoWeights, ...(repoWeights ?? {}) };
  }

  if (options.orgAffiliationMap) {
    const affiliationMap = await loadOptionalJsonFile<AffiliationInput>(options.orgAffiliationMap);
    config.affiliationMap = {
      ...config.affiliationMap,
      ...normalizeAffiliationMap(affiliationMap),
    };
  }

  if (options.labelRulesFile) {
    const labelRules = await loadOptionalJsonFile<Partial<LabelRules>>(options.labelRulesFile);
    config.labelRules = mergeLabelRules(config.labelRules, labelRules);
  }

  if (options.issueWeightsFile) {
    const issueWeights = await loadOptionalJsonFile<Partial<IssueScoringWeights>>(options.issueWeightsFile);
    if (issueWeights && config.issueWeights) {
      config.issueWeights = { ...config.issueWeights, ...issueWeights };
    }
  }

  return config;
}

export async function loadConfig(options: CliOptions): Promise<ConfigBundle> {
  const config: ConfigBundle = {
    weights: { ...DEFAULT_CONFIG.weights },
    repoWeights: { ...DEFAULT_CONFIG.repoWeights },
    affiliationMap: { ...DEFAULT_CONFIG.affiliationMap },
    lowHangingThresholds: { ...DEFAULT_CONFIG.lowHangingThresholds },
    labelRules: { ...DEFAULT_CONFIG.labelRules },
    codeJamThresholds: { ...DEFAULT_CONFIG.codeJamThresholds },
  };

  if (options.weightsFile) {
    const weights = await loadOptionalJsonFile<Partial<ScoringWeights>>(options.weightsFile);
    config.weights = mergeWeights(config.weights, weights);
  }

  if (options.repoBusinessWeight) {
    const repoWeights = await loadOptionalJsonFile<Record<string, number>>(options.repoBusinessWeight);
    config.repoWeights = { ...config.repoWeights, ...(repoWeights ?? {}) };
  }

  if (options.orgAffiliationMap) {
    const affiliationMap = await loadOptionalJsonFile<AffiliationInput>(options.orgAffiliationMap);
    config.affiliationMap = {
      ...config.affiliationMap,
      ...normalizeAffiliationMap(affiliationMap),
    };
  }

  if (options.lowHangingThresholds) {
    const thresholds = await loadOptionalJsonFile<Partial<LowHangingThresholds>>(options.lowHangingThresholds);
    config.lowHangingThresholds = mergeLowHanging(config.lowHangingThresholds, thresholds);
  }

  if (options.labelRulesFile) {
    const labelRules = await loadOptionalJsonFile<Partial<LabelRules>>(options.labelRulesFile);
    config.labelRules = mergeLabelRules(config.labelRules, labelRules);
  }

  if (options.codeJamThresholdsFile) {
    const codeJamThresholds = await loadOptionalJsonFile<Partial<CodeJamThresholds>>(options.codeJamThresholdsFile);
    config.codeJamThresholds = mergeCodeJamThresholds(config.codeJamThresholds, codeJamThresholds);
  }

  return config;
}
