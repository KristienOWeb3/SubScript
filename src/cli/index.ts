#!/usr/bin/env node

/**
 * generatedBy: "SubScript CLI"
 * entrypoint: "src/cli/index.ts"
 * description: "TypeScript ESM-compatible CLI for scaffolding SubScript protocol integrations."
 */

import { runInit } from "./commands/init.js";
import { runAddCheckout } from "./commands/addCheckout.js";
import { runAddWebhook } from "./commands/addWebhook.js";
import { runVerify } from "./commands/verify.js";
import { runDoctor } from "./commands/doctor.js";
import { runUpdate } from "./commands/update.js";

const red = "\x1b[31m";
const green = "\x1b[38;2;0;210;180m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

function printUsage() {
  console.log(`
${green}${bold}SubScript CLI${reset} - Production Integration Scaffolder

Usage:
  npx @subscript/cli <command> [options]

Commands:
  ${bold}init${reset}          Complete integration bootstrap
  ${bold}add checkout${reset}  Generate standard or ZK checkout buttons
  ${bold}add webhook${reset}   Generate signature-verified webhook endpoints
  ${bold}verify${reset}        Validate local configuration and connection states
  ${bold}doctor${reset}        Audit repository files and configurations
  ${bold}update${reset}        Safely upgrade generated files with backups

Options:
  --session <token>    Onboarding bridge session token (required for init)
  --mode <mode>        Standard or ZK-routed payment mode ('standard' | 'zk-routed')
  --no-telemetry       Decline telemetry event logging
`);
}

function parseFlags(argv: string[]) {
  const args = argv.slice(2);
  const command = args[0] || "";
  const subCommand = args[1] || "";

  let session = "";
  let mode = "";
  let noTelemetry = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session" && args[i + 1]) {
      session = args[i + 1];
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      mode = args[i + 1];
      i++;
    } else if (args[i] === "--no-telemetry") {
      noTelemetry = true;
    }
  }

  return { command, subCommand, session, mode, noTelemetry };
}

async function main() {
  const { command, subCommand, session, mode, noTelemetry } = parseFlags(process.argv);

  if (!command) {
    printUsage();
    process.exit(0);
  }

  switch (command.toLowerCase()) {
    case "init":
      await runInit({ session, mode, noTelemetry });
      break;

    case "add":
      if (subCommand.toLowerCase() === "checkout") {
        await runAddCheckout({ noTelemetry });
      } else if (subCommand.toLowerCase() === "webhook") {
        await runAddWebhook({ noTelemetry });
      } else {
        console.error(`\n${red}${bold}Error:${reset} Unknown add target "${subCommand}". Use "checkout" or "webhook".`);
        process.exit(1);
      }
      break;

    case "verify":
      await runVerify({ noTelemetry });
      break;

    case "doctor":
      await runDoctor();
      break;

    case "update":
      await runUpdate({ noTelemetry });
      break;

    default:
      console.error(`\n${red}${bold}Error:${reset} Unknown command "${command}".`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n${red}${bold}Fatal:${reset} ${err.message || err}`);
  process.exit(1);
});
