// Wanxiangshu model scheduler — tuned for verified healthy local providers.
// Active providers:
// - ctyun: deepseek-v4-pro-0813-oc, glm-5.3-oc
// - kw92.cyou: google-antigravity/gemini-3.8-flash, gemini-3.7-flash
// - openai (DeepSeek official): deepseek-chat, deepseek-reasoner
// - wave-anthropic / rc-anthropic: claude-sonnet-5
// - omniroute-ai: step/step-3.5-flash-2603, gc/grok-composer-2.5-fast

const PROVIDER_LIMITS = {
  'ctyun': 8,
  'kw92.cyou': 8,
  'openai': 8,
  'wave-anthropic': 4,
  'rc-anthropic': 4,
  'omniroute-ai': 8,
}

const DEFAULT_LIMIT = 4
const providerOf = (model) => model.slice(0, model.indexOf('/'))
const failedProviders = new Set()

export const markProviderFailed = (provider) => {
  if (provider) failedProviders.add(provider)
}
export const clearFailedProviders = () => { failedProviders.clear() }
export const providerCapacity = (provider) => {
  if (failedProviders.has(provider)) return 0
  return PROVIDER_LIMITS[provider] ?? DEFAULT_LIMIT
}

const isAvailable = (running, model) => {
  const provider = providerOf(model)
  const limit = providerCapacity(provider)
  if (limit <= 0) return false
  return running.filter((item) => providerOf(item.model) === provider).length < limit
}

const targetOf = ([model, reasoning]) => ({ model, reasoning })

const pick = (running, previous, candidates) => {
  if (previous) {
    const preferred = candidates.find(
      ([model, reasoning]) => model === previous.model && reasoning === previous.reasoning,
    )
    if (preferred && isAvailable(running, preferred[0])) return targetOf(preferred)
  }
  for (const candidate of candidates) {
    if (isAvailable(running, candidate[0])) return targetOf(candidate)
  }
  return null
}

// Low latency / low cost (notes, reflection, title)
const CHEAP = [
  ['kw92.cyou/google-antigravity/gemini-3.8-flash', 'none'],
  ['kw92.cyou/google-antigravity/gemini-3.7-flash', 'none'],
  ['omniroute-ai/step/step-3.5-flash-2603', 'none'],
]

// Super fast short tasks
const FLASH = [
  ['kw92.cyou/google-antigravity/gemini-3.8-flash', 'none'],
  ['omniroute-ai/step/step-3.5-flash-2603', 'none'],
]

// Standard workhorses: high intelligence + fast response
const STANDARD = [
  ['ctyun/deepseek-v4-pro-0813-oc', 'none'],
  ['ctyun/glm-5.3-oc', 'none'],
  ['openai/deepseek-chat', 'none'],
  ['kw92.cyou/google-antigravity/gemini-3.8-flash', 'none'],
]

// High reasoning / hard planning / architecture review
const PREMIUM = [
  ['ctyun/deepseek-v4-pro-0813-oc', 'high'],
  ['ctyun/glm-5.3-oc', 'high'],
  ['openai/deepseek-reasoner', 'high'],
  ['wave-anthropic/claude-sonnet-5', 'high'],
  ['rc-anthropic/claude-sonnet-5', 'high'],
]

const ENGINEER_POOL = [...STANDARD, ...PREMIUM, ...FLASH]
const MANAGER_POOL = [...STANDARD, ...PREMIUM]
const ORCHESTRATOR_POOL = [...STANDARD, ...PREMIUM]
const DEVOPS_POOL = [...STANDARD, ...PREMIUM]
const BLOGGER_POOL = [...CHEAP]
const BOOKKEEPER_POOL = [...FLASH, ...STANDARD]
const PREDICTOR_POOL = [...CHEAP, ...FLASH]

const pools = new Map([
  ['engineer', ENGINEER_POOL],
  ['manager', MANAGER_POOL],
  ['orchestrator', ORCHESTRATOR_POOL],
  ['devops', DEVOPS_POOL],
  ['blogger', BLOGGER_POOL],
  ['bookkeeper', BOOKKEEPER_POOL],
  ['predictor', PREDICTOR_POOL],
])

export const hasTheoreticalCapacity = (role) => {
  const candidates = pools.get(role)
  if (!candidates || candidates.length === 0) return false
  return candidates.some(([model]) => providerCapacity(providerOf(model)) > 0)
}

export default function route(role, running, previous) {
  if (role === 'devops' && previous && isAvailable(running, previous.model)) return previous
  const candidates = pools.get(role)
  if (!candidates) return null
  return pick(running, previous, candidates)
}
