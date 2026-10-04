import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

let css: Promise<string> | undefined;
const bundles = new Map<string, Promise<string>>();

// Render the production page components with deterministic wallet/router adapters.
// The server's auth gate remains untouched; this fixture tests layout, not authentication.
export function dashboardStyles() {
  return css ??= (async () => {
    const source = path.resolve("src/app/globals.css");
    return (await postcss([tailwindcss({ base: process.cwd() })]).process(fs.readFileSync(source, "utf8"), { from: source })).css;
  })();
}

export function dashboardBundle(pagePath: string) {
  let bundle = bundles.get(pagePath);
  if (bundle) return bundle;
  bundle = build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Page from './${pagePath}'; createRoot(document.getElementById('root')).render(<Page/>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "layout-adapters", setup(builder) {
      builder.onResolve({ filter: /^(next\/(link|image|navigation)|wagmi(\/actions|\/connectors)?|@\/lib\/wagmi|crypto|@circle-fin\/w3s-pw-web-sdk)$/ }, args => ({ path: args.path, namespace: "layout-adapter" }));
      builder.onLoad({ filter: /.*/, namespace: "layout-adapter" }, args => {
        if (args.path === "next/link") return { contents: `import React from 'react'; export default function Link({children,prefetch,replace,scroll,...props}){return <a {...props}>{children}</a>;}`, loader: "tsx", resolveDir: process.cwd() };
        if (args.path === "next/image") return { contents: `import React from 'react'; export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}`, loader: "tsx", resolveDir: process.cwd() };
        if (args.path === "crypto") return { contents: `export default {createHash(){throw Error('Server identity hashing must not run in a layout fixture');}};`, loader: "js" };
        if (args.path === "@circle-fin/w3s-pw-web-sdk") return { contents: `export class W3SSdk {constructor(){} execute(){throw Error('Wallet signing is outside a layout fixture');}}`, loader: "js" };
        if (args.path === "next/navigation") return { contents: `const router={push:url=>window.location.href=url,replace:url=>history.replaceState(null,'',url),refresh:()=>{},back:()=>history.back(),prefetch:()=>{}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`, loader: "js" };
        if (args.path === "@/lib/wagmi") return { contents: `export {arcTestnet as activeArcChain} from 'viem/chains';export const config={};`, loader: "js", resolveDir: process.cwd() };
        if (args.path === "wagmi/connectors") return { contents: "export const injected=()=>({id:'layout'});", loader: "js" };
        if (args.path === "wagmi/actions") return { contents: "export const getAccount=()=>({isConnected:false});", loader: "js" };
        return { contents: `
          const noop=()=>{};const refetch=async()=>({data:123456789123456n});const read={data:123456789123456n,refetch,isLoading:false};
          const multi={data:[{status:'success',result:123456789123456n}],refetch,isLoading:false};const account={address:undefined,isConnected:false};const config={};
          export const useAccount=()=>account;export const useConfig=()=>config;
          export const useDisconnect=()=>({disconnect:noop});export const useConnect=()=>({connect:noop,connectors:[]});
          export const useSwitchChain=()=>({switchChain:noop,switchChainAsync:async()=>{}});
          export const useWriteContract=()=>({writeContractAsync:async()=>undefined,isPending:false});
          export const useSignMessage=()=>({signMessageAsync:async()=>''});export const useSignTypedData=()=>({signTypedDataAsync:async()=>''});
          export const useReadContract=()=>read;export const useReadContracts=()=>multi;
        `, loader: "js" };
      });
    } }],
  }).then(result => result.outputFiles[0].text);
  bundles.set(pagePath, bundle);
  return bundle;
}
