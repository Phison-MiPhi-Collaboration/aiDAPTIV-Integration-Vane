// KM (KV-cache Knowledge Manager) settings. KM is on by default; set
// KM_ENABLED=false to fall back to Vane's original top-k upload search.

export type KmConfig = {
  enabled: boolean;
  maxTokensPerGroup: number;
  tokenMargin: number;
  stickyTopK: number;
};

const readNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getKmConfig = (): KmConfig => {
  const enabledEnv = (process.env.KM_ENABLED ?? 'true').trim().toLowerCase();

  return {
    enabled: !['false', '0', 'no', 'off'].includes(enabledEnv),
    maxTokensPerGroup: readNumber(process.env.KM_MAX_TOKENS_PER_GROUP, 8000),
    // js-tiktoken (cl100k) counts differ from the served model's tokenizer.
    tokenMargin: Math.min(readNumber(process.env.KM_TOKEN_MARGIN, 0.1), 0.5),
    stickyTopK: readNumber(process.env.KM_STICKY_TOP_K, 10),
  };
};

export const isKmEnabled = () => getKmConfig().enabled;
