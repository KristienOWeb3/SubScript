import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.error("Missing RESEND_API_KEY in environment");
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);
const FROM_ADDRESS = "SubScript <notifications@subscriptonarc.com>";
const ARC_BANNER_URL = "https://jkrlsjpsytzffwjpixue.supabase.co/storage/v1/object/public/profiles/banners/arc-3d-banner-v4.png";

// The 77 unique real testnet user signups discovered from the testnet database
const RAW_TESTNET_EMAILS = [
  "0xsain247@gmail.com",
  "abdulwaheedsulyman121@gmail.com",
  "abdulwaheedsulyman209@gmail.com",
  "adeniyiayomide109@gmail.com",
  "aghatiseehioghae644@gmail.com",
  "aminamustapha557@gmail.com",
  "anigbatawisdom663@gmail.com",
  "annacletusjustice@gmail.com",
  "astalagkramki@gmail.com",
  "bilalauamar2@gmail.com",
  "brightmetax1@gmail.com",
  "choppaxfree@gmail.com",
  "chuksokechukwu96@gmail.com",
  "counterfeitthanos@gmail.com",
  "dammyridwan79@gmail.com",
  "danbbj3@gmail.com",
  "danieldonald1st@gmail.com",
  "davidafiakurue@gmail.com",
  "deelyst@gmail.com",
  "deyemi855@gmail.com",
  "dominionafiakurue@gmail.com",
  "ejikemartin635@gmail.com",
  "ezzy_brandquest@yahoo.com",
  "ezzy.brandquest2@gmail.com",
  "godofhackkevin@gmail.com",
  "hadeyemi2000@gmail.com",
  "hassanishaabdulaziz@gmail.com",
  "hh1085673@gmail.com",
  "hillokoye9@gmail.com",
  "ifedominon@gmail.com",
  "ihate20people@gmail.com",
  "ihmar5thh@gmail.com",
  "israelgold354@gmail.com",
  "issakhalid849@gmail.com",
  "jeremiahhxue@gmail.com",
  "katie@augusthealth.com",
  "kingdomuzoigwe39@gmail.com",
  "kristien@gmail.com",
  "kristien@subscript.io",
  "kristienoweb3@gmail.com",
  "kristienoweb3+signup-test@gmail.com",
  "lilithodefi@gmail.com",
  "macanthonyeke@gmail.com",
  "maureenezeh41@gmail.com",
  "mayalu7000@gmail.com",
  "meekah2000@gmail.com",
  "mikelharbor90@gmail.com",
  "miyanaaswt@gmail.com",
  "musabawaaisha31@gmail.com",
  "nceenterprises542@gmail.com",
  "nicades32@gmail.com",
  "nwosustephen23@gmail.com",
  "ogbindivine@gmail.com",
  "okaforchigozie112@gmail.com",
  "okechukwuanigbata5@gmail.com",
  "okechukwuanugbata5@gmail.com",
  "okenewanwan@gmail.com",
  "olosasahabideen@gmail.com",
  "onigbemi005@gmail.com",
  "onwumeluifunanaya@gmail.com",
  "otegbayooluwaseyi@gmail.com",
  "owolabioreoluwaozella@gmail.com",
  "oxpristian@gmail.com",
  "phoenixgraphicals@gmail.com",
  "ptuskinroman@gmail.com",
  "robotkaykay@gmail.com",
  "sageoficial001@gmail.com",
  "sapenzy@gmail.com",
  "subscriptprotocol@gmail.com",
  "temidayopaul012@gmil.com", // Typo in domain: will be corrected to gmail.com
  "temidayoracheal64@gmail.com",
  "ticerbuddy@gmail.com",
  "timothyterzulum6@gmail.com",
  "tvafocus@gmail.com",
  "ubaiduisa@gmail.com",
  "wesleyemmet02@gmail.com",
  "zaramuomelite@gmail.com"
];

function sanitizeEmail(email) {
  let cleaned = email.trim().toLowerCase();
  if (cleaned.endsWith("@gmil.com")) {
    cleaned = cleaned.replace("@gmil.com", "@gmail.com");
  }
  return cleaned;
}

export function buildMainnetLaunchEmail(toEmail) {
  const subject = "SubScript is Officially Live on Arc Mainnet 🟢 — Activate Your Account";
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#08090a;font-family:'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#cbd5e1;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#08090a;padding:24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background-color:#0d0f12;border:1px solid #1f242e;border-radius:20px;overflow:hidden;padding:0;box-shadow:0 8px 30px rgba(0,0,0,0.4);">
          
          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding:28px 24px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:8px 22px;">
                <tr>
                  <td>
                    <span style="font-family:'Outfit','Inter',sans-serif;font-size:20px;font-weight:900;letter-spacing:-0.5px;color:#08090a;">Sub<span style="color:#00a892;">Script</span></span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 3D Arc Mainnet Banner -->
          <tr>
            <td style="padding:0 20px 16px;">
              <div style="border-radius:16px;overflow:hidden;border:1px solid #282d38;background:#181b22;text-align:center;">
                <img src="${ARC_BANNER_URL}" alt="SubScript on Arc Mainnet" width="100%" style="display:block;max-height:180px;width:100%;object-fit:cover;" />
              </div>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding:12px 28px 28px;">
              <div style="text-align:center;margin-bottom:18px;">
                <span style="display:inline-block;padding:5px 14px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);border-radius:9999px;font-size:12px;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:0.5px;">
                  🟢 Mainnet Live (Chain ID 5042)
                </span>
              </div>

              <h1 style="margin:0 0 16px;font-size:23px;font-weight:800;color:#ffffff;text-align:center;letter-spacing:-0.5px;line-height:1.3;">
                SubScript is Live on Arc Mainnet
              </h1>

              <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#94a3b8;">
                Hi there,
              </p>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#cbd5e1;">
                Thank you for being an early pioneer and testing SubScript during our testnet phases. We are excited to announce that <strong>SubScript Protocol is officially live on Arc Mainnet (Chain ID 5042)</strong>!
              </p>

              <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#94a3b8;">
                Because Arc Mainnet is a completely dedicated, production-isolated financial network, <strong>testnet sandbox accounts and test balances do not carry over</strong>. You can now create your official Mainnet account to start accepting and moving real USDC with instant settlement.
              </p>

              <!-- Feature Highlights Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#13151b;border:1px solid #232732;border-radius:14px;padding:16px 20px;margin:0 0 24px;">
                <tr>
                  <td style="padding-bottom:12px;border-bottom:1px solid #1e222b;">
                    <strong style="color:#ffffff;font-size:14px;">⚡ Native USDC Settlement</strong>
                    <div style="color:#8b929e;font-size:13px;margin-top:2px;">Instant finality and micro-fees powered directly by Circle's Arc Network.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #1e222b;">
                    <strong style="color:#ffffff;font-size:14px;">🔐 Non-Custodial &amp; Web3 Native</strong>
                    <div style="color:#8b929e;font-size:13px;margin-top:2px;">Sign in via email OTP (Circle MPC embedded wallet) or connect MetaMask, Rabby, Phantom, or OKX.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #1e222b;">
                    <strong style="color:#ffffff;font-size:14px;">🔄 Subscriptions &amp; Metered Vaults</strong>
                    <div style="color:#8b929e;font-size:13px;margin-top:2px;">Automated recurring charges, period-end dispute protection, and metered escrow vaults.</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:12px;">
                    <strong style="color:#ffffff;font-size:14px;">🔗 Hosted Checkout &amp; Pay Links</strong>
                    <div style="color:#8b929e;font-size:13px;margin-top:2px;">Generate shareable checkout links with on-chain receipts and verified transaction memos.</div>
                  </td>
                </tr>
              </table>

              <!-- Primary CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 14px;">
                <tr>
                  <td align="center">
                    <a href="https://www.subscriptonarc.com/signup" target="_blank" style="display:inline-block;width:80%;max-width:320px;padding:14px 24px;background-color:#00d2b4;color:#08090a;font-size:15px;font-weight:700;text-decoration:none;border-radius:9999px;text-align:center;box-shadow:0 4px 14px rgba(0,210,180,0.3);">
                      Create Mainnet Account →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Secondary Link -->
              <p style="text-align:center;margin:0 0 24px;font-size:13px;color:#8b929e;">
                Already have a mainnet wallet? <a href="https://www.subscriptonarc.com/signin" target="_blank" style="color:#38bdf8;text-decoration:none;font-weight:600;">Sign in to Dashboard</a>
              </p>

              <!-- Divider -->
              <div style="border-top:1px solid #1f242e;margin:24px 0 18px;"></div>

              <!-- Footer Note -->
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;text-align:center;">
                SubScript Protocol &bull; Programmable USDC Commerce on Arc Network<br>
                You received this notice because you registered on the SubScript testnet.<br>
                <a href="https://www.subscriptonarc.com" target="_blank" style="color:#64748b;text-decoration:underline;">subscriptonarc.com</a> &bull; <a href="https://docs.subscriptonarc.com" target="_blank" style="color:#64748b;text-decoration:underline;">Documentation</a> &bull; <a href="https://www.subscriptonarc.com/privacy" target="_blank" style="color:#64748b;text-decoration:underline;">Privacy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `SubScript is Officially Live on Arc Mainnet (Chain ID 5042)

Hi there,

Thank you for testing SubScript during our testnet phases. We are thrilled to announce that SubScript Protocol is officially live on Arc Mainnet!

Because Arc Mainnet is a completely new, production-isolated settlement layer, testnet sandbox accounts and test balances do not carry over.

You can now create and claim your permanent Mainnet account to access:
- Native USDC instant micro-settlement on Arc Network
- Non-custodial MPC wallet (Circle Web3 Services) or direct browser wallet login
- Automated recurring subscriptions and metered escrow vaults
- Hosted payment links with verified on-chain memos

Create your Mainnet account now:
https://www.subscriptonarc.com/signup

Already have a wallet? Sign in:
https://www.subscriptonarc.com/signin

SubScript Protocol — Programmable USDC payments for modern commerce.
https://www.subscriptonarc.com`;

  return {
    from: FROM_ADDRESS,
    to: toEmail,
    subject,
    html,
    text,
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const isSendAll = args.includes("--send-all");
  const testIndex = args.indexOf("--test");
  const testTarget = testIndex !== -1 ? args[testIndex + 1] : null;

  // Deduplicate and sanitize
  const uniqueMap = new Map();
  for (const raw of RAW_TESTNET_EMAILS) {
    const cleaned = sanitizeEmail(raw);
    if (cleaned && cleaned.includes("@") && !uniqueMap.has(cleaned)) {
      uniqueMap.set(cleaned, raw);
    }
  }
  const cleanList = Array.from(uniqueMap.keys());

  console.log(`\n======================================================`);
  console.log(`  SubScript Protocol — Mainnet Launch Email Campaign  `);
  console.log(`======================================================`);
  console.log(`Sender:       ${FROM_ADDRESS}`);
  console.log(`Total Emails: ${cleanList.length} unique sanitized recipients`);
  console.log(`Mode:         ${testTarget ? `Test Single (${testTarget})` : isSendAll ? "Full Campaign Blast (--send-all)" : "Dry Run (pass --test <email> or --send-all)"}`);
  console.log(`======================================================\n`);

  if (testTarget) {
    console.log(`Dispatching test preview to ${testTarget}...`);
    const emailPayload = buildMainnetLaunchEmail(testTarget);
    try {
      const response = await resend.emails.send(emailPayload);
      if (response.error) {
        console.error(`❌ Test send failed:`, response.error);
      } else {
        console.log(`✅ Test email delivered successfully! Resend ID: ${response.data?.id}`);
      }
    } catch (err) {
      console.error(`❌ Unexpected error:`, err);
    }
    return;
  }

  if (!isSendAll) {
    console.log(`DRY RUN PREVIEW: The following ${cleanList.length} recipients would be emailed:`);
    cleanList.forEach((e, idx) => console.log(`  ${(idx + 1).toString().padStart(2, " ")}. ${e}`));
    console.log(`\nTo run the actual dispatch, execute:`);
    console.log(`  node scripts/send-testnet-launch-emails.mjs --send-all`);
    console.log(`Or test first with:`);
    console.log(`  node scripts/send-testnet-launch-emails.mjs --test <your-email>\n`);
    return;
  }

  console.log(`🚀 STARTING LIVE CAMPAIGN DISPATCH to ${cleanList.length} recipients...\n`);

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < cleanList.length; i++) {
    const email = cleanList[i];
    const progress = `[${i + 1}/${cleanList.length}]`;
    const payload = buildMainnetLaunchEmail(email);

    try {
      process.stdout.write(`${progress} Sending to ${email}... `);
      const response = await resend.emails.send(payload);

      if (response.error) {
        console.log(`❌ FAILED: ${response.error.message}`);
        results.push({ email, status: "error", error: response.error.message });
        failureCount++;
      } else {
        console.log(`✅ OK (${response.data?.id})`);
        results.push({ email, status: "sent", id: response.data?.id });
        successCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`❌ ERROR: ${msg}`);
      results.push({ email, status: "error", error: msg });
      failureCount++;
    }

    // Pacing delay (500ms = 2/sec) to avoid rate limits
    await sleep(500);
  }

  console.log(`\n======================================================`);
  console.log(`  Campaign Dispatch Complete!  `);
  console.log(`  Total Attempted: ${cleanList.length}`);
  console.log(`  Successful:      ${successCount}`);
  console.log(`  Failed:          ${failureCount}`);
  console.log(`======================================================\n`);
}

main().catch(console.error);
