export interface ConfigTemplateOptions {
  merchantAddress: string;
  mode: "standard" | "privacy-routed";
  tier: number;
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrencyDecimals: number;
  routerAddress: string;
  standardAddress: string;
  usdcAddress: string;
  feeBps: number;
  cliVersion: string;
  templateVersion: string;
  requestId: string;
  generationTimestamp: string;
}

export function generateConfigTemplate(opts: ConfigTemplateOptions): string {
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
  networkName: "${opts.networkName}",
  rpcUrl: "${opts.rpcUrl}",
  explorerUrl: "${opts.explorerUrl}",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: ${opts.nativeCurrencyDecimals},
  },
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
