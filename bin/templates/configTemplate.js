export function generateConfigTemplate(opts) {
    return `/**
 * generatedBy: "SubScript CLI"
 * cliVersion: "${opts.cliVersion}"
 * templateVersion: "${opts.templateVersion}"
 * requestId: "${opts.requestId}"
 * generationTimestamp: "${opts.generationTimestamp}"
 */

export const subscriptConfig = {
  merchantAddress: "${opts.merchantAddress}",
  mode: "${opts.mode}",
  tier: ${opts.tier},
  chainId: ${opts.chainId},
  routerAddress: "${opts.routerAddress}",
  standardAddress: "${opts.standardAddress}",
  usdcAddress: "${opts.usdcAddress}",
  feeBps: ${opts.feeBps},
  protocolVersion: "${opts.templateVersion}",
  minimumSupportedVersion: "1.1.0"
} as const;

export type SubScriptConfig = typeof subscriptConfig;
`;
}
